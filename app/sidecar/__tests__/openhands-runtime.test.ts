import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter, PassThrough } from "node:stream";

// Mock child_process before importing the runtime
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import * as childProcess from "node:child_process";
import { OpenHandsRuntime } from "../runtime/openhands-runtime.js";
import type { OneShotRunRequest, RuntimeSink } from "../runtime/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/**
 * Creates a mock child process that emits the given stdout lines (JSONL)
 * and exits with the given code.
 */
function makeMockChild(stdoutLines: string[], exitCode = 0) {
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

  // Emit lines after a tick so readline can attach
  setImmediate(() => {
    for (const line of stdoutLines) {
      stdout.write(line + "\n");
    }
    stdout.end();
    stderr.end();
    child.emit("close", exitCode);
  });

  return child;
}

const mockSpawn = vi.mocked(childProcess.spawn);

function getRunResult(messages: Record<string, unknown>[]) {
  return messages.find(
    (m) =>
      m.type === "agent_event" &&
      (m.event as Record<string, unknown>)?.type === "run_result",
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OpenHandsRuntime.runOnce", () => {
  it("spawns python3 with the runner path", async () => {
    const child = makeMockChild([
      JSON.stringify({
        type: "openhands_result",
        status: "success",
        result_text: "done",
        structured_output: null,
        timestamp: Date.now(),
      }),
    ]);
    mockSpawn.mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    );

    const runtime = new OpenHandsRuntime();
    const { sink } = makeSink();
    await runtime.runOnce(makeRequest(), sink);

    expect(mockSpawn).toHaveBeenCalledWith(
      "python3",
      expect.arrayContaining([expect.stringContaining("runner.py")]),
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
    );
  });

  it("spawns the packaged runner directly when pathToOpenHandsRunner is provided", async () => {
    const child = makeMockChild([
      JSON.stringify({
        type: "openhands_result",
        status: "success",
        result_text: "done",
        structured_output: null,
        timestamp: Date.now(),
      }),
    ]);
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

    // Capture what gets written to stdin
    stdin.on("data", (chunk: Buffer) => {
      stdinWritten += chunk.toString();
    });

    setImmediate(() => {
      stdout.write(
        JSON.stringify({
          type: "openhands_result",
          status: "success",
          result_text: "done",
          structured_output: null,
          timestamp: Date.now(),
        }) + "\n",
      );
      stdout.end();
      stderr.end();
      child.emit("close", 0);
    });

    mockSpawn.mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    );

    const runtime = new OpenHandsRuntime();
    const { sink } = makeSink();
    await runtime.runOnce(request, sink);

    // Should have written the request JSON to stdin
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
    expect(serialized.outputFormat).toEqual({
      type: "json_schema",
      schema: {
        type: "object",
        required: ["status"],
        properties: {
          status: { type: "string" },
        },
      },
    });
    expect(serialized.workspaceRootDir).toBe("/tmp/workspace-root");
    expect(serialized.workspaceSkillDir).toBe(
      "/tmp/workspace-root/plugin/skill",
    );
  });

  it("serializes explicit maxTurns into the runner request", async () => {
    const request = makeRequest({ maxTurns: 12 });
    let stdinWritten = "";

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

    stdin.on("data", (chunk: Buffer) => {
      stdinWritten += chunk.toString();
    });

    setImmediate(() => {
      stdout.write(
        JSON.stringify({
          type: "openhands_result",
          status: "success",
          result_text: "done",
          structured_output: null,
          timestamp: Date.now(),
        }) + "\n",
      );
      stdout.end();
      stderr.end();
      child.emit("close", 0);
    });

    mockSpawn.mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    );

    const runtime = new OpenHandsRuntime();
    const { sink } = makeSink();
    await runtime.runOnce(request, sink);

    const serialized = JSON.parse(stdinWritten) as Record<string, unknown>;
    expect(serialized.maxTurns).toBe(12);
  });

  it("emits run_result with status completed on successful stdout lines", async () => {
    const child = makeMockChild([
      JSON.stringify({
        type: "openhands_event",
        event_kind: "message",
        text: "Processing...",
        timestamp: Date.now(),
      }),
      JSON.stringify({
        type: "openhands_result",
        status: "success",
        result_text: "All done!",
        structured_output: null,
        timestamp: Date.now(),
      }),
    ]);
    mockSpawn.mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    );

    const runtime = new OpenHandsRuntime();
    const { messages, sink } = makeSink();
    await runtime.runOnce(makeRequest(), sink);

    const runResult = getRunResult(messages);
    expect(runResult).toBeDefined();
    const event = runResult!.event as Record<string, unknown>;
    expect(event.status).toBe("completed");

    // Should also have a display item for the message event
    const displayItems = messages.filter((m) => m.type === "display_item");
    const outputItem = displayItems.find(
      (m) => (m.item as Record<string, unknown>).type === "output",
    );
    expect(outputItem).toBeDefined();
  });

  it("emits error run_result when process exits with non-zero code and no result", async () => {
    const child = makeMockChild([], 1 /* non-zero exit code */);
    mockSpawn.mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    );

    const runtime = new OpenHandsRuntime();
    const { messages, sink } = makeSink();
    await runtime.runOnce(makeRequest(), sink);

    const runResult = getRunResult(messages);
    expect(runResult).toBeDefined();
    const event = runResult!.event as Record<string, unknown>;
    expect(event.status).toBe("error");
    expect(JSON.stringify(event)).toContain("exit");
  });

  it("kills child process when abort signal fires", async () => {
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

    // Don't close the child immediately — let the abort trigger it
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    child.kill = vi.fn(() => {
      // Simulate process being killed
      if (closeTimer) clearTimeout(closeTimer);
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

    // Abort after the spawn but before the process exits
    setImmediate(() => {
      controller.abort();
    });

    const runtime = new OpenHandsRuntime();
    const { messages, sink } = makeSink();
    await runtime.runOnce(makeRequest(), sink, controller.signal);

    expect(child.kill).toHaveBeenCalled();

    // Should emit some form of terminal run_result
    const runResult = getRunResult(messages);
    expect(runResult).toBeDefined();
  });

  it("rejects one-shot requests that include AskUserQuestion", async () => {
    const runtime = new OpenHandsRuntime();
    const { messages, sink } = makeSink();

    // Should throw synchronously before spawning
    await expect(
      runtime.runOnce(makeRequest({ allowedTools: ["AskUserQuestion"] }), sink),
    ).rejects.toThrow(
      "one-shot runtime requests cannot include user-question tools",
    );

    // Should not have spawned anything
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(messages).toHaveLength(0);
  });

  it("forwards stderr from child process as sdk_stderr system events", async () => {
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
      stderr.write("python error: something went wrong\n");
      stderr.end();
      stdout.write(
        JSON.stringify({
          type: "openhands_result",
          status: "success",
          result_text: "ok",
          structured_output: null,
          timestamp: Date.now(),
        }) + "\n",
      );
      stdout.end();
      child.emit("close", 0);
    });

    mockSpawn.mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    );

    const runtime = new OpenHandsRuntime();
    const { messages, sink } = makeSink();
    await runtime.runOnce(makeRequest(), sink);

    const stderrMsg = messages.find(
      (m) =>
        m.type === "system" &&
        m.subtype === "sdk_stderr" &&
        typeof m.data === "string" &&
        (m.data as string).includes("python error"),
    );
    expect(stderrMsg).toBeDefined();
  });

  it("redacts the API key from child stderr system events", async () => {
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
      stderr.write("request failed for sk-llm-test\n");
      stderr.end();
      stdout.write(
        JSON.stringify({
          type: "openhands_result",
          status: "success",
          result_text: "ok",
          structured_output: null,
          timestamp: Date.now(),
        }) + "\n",
      );
      stdout.end();
      child.emit("close", 0);
    });

    mockSpawn.mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    );

    const runtime = new OpenHandsRuntime();
    const { messages, sink } = makeSink();
    await runtime.runOnce(makeRequest(), sink);

    const stderrMessages = messages.filter(
      (m) => m.type === "system" && m.subtype === "sdk_stderr",
    );
    expect(JSON.stringify(stderrMessages)).not.toContain("sk-llm-test");
    expect(JSON.stringify(stderrMessages)).toContain("[REDACTED]");
  });

  it("redacts llm extra header values from child stderr system events", async () => {
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
      stderr.write("provider rejected secure-route\n");
      stderr.end();
      stdout.write(
        JSON.stringify({
          type: "openhands_result",
          status: "success",
          result_text: "ok",
          structured_output: null,
          timestamp: Date.now(),
        }) + "\n",
      );
      stdout.end();
      child.emit("close", 0);
    });

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

    const stderrMessages = messages.filter(
      (m) => m.type === "system" && m.subtype === "sdk_stderr",
    );
    expect(JSON.stringify(stderrMessages)).not.toContain("secure-route");
    expect(JSON.stringify(stderrMessages)).toContain("[REDACTED]");
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
