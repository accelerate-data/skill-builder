import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";

// Mock the SDK before importing anything that uses it
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  parseIncomingMessage,
  wrapWithRequestId,
  runPersistent,
} from "../persistent-mode.js";

const mockQuery = vi.mocked(query);

// =====================================================================
// Unit tests: parseIncomingMessage
// =====================================================================

describe("parseIncomingMessage", () => {
  it("parses a valid agent_request", () => {
    const line = JSON.stringify({
      type: "agent_request",
      request_id: "req_1",
      config: { prompt: "hello", apiKey: "sk-test", cwd: "/tmp" },
    });
    const result = parseIncomingMessage(line);
    expect(result).toEqual({
      type: "agent_request",
      request_id: "req_1",
      config: { prompt: "hello", apiKey: "sk-test", cwd: "/tmp" },
    });
  });

  it("parses a valid shutdown message", () => {
    const line = JSON.stringify({ type: "shutdown" });
    const result = parseIncomingMessage(line);
    expect(result).toEqual({ type: "shutdown" });
  });

  it("returns null for empty string", () => {
    expect(parseIncomingMessage("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseIncomingMessage("   \t  ")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseIncomingMessage("{bad json}")).toBeNull();
  });

  it("returns null for non-object JSON (number)", () => {
    expect(parseIncomingMessage("42")).toBeNull();
  });

  it("returns null for non-object JSON (string)", () => {
    expect(parseIncomingMessage('"hello"')).toBeNull();
  });

  it("returns null for null JSON", () => {
    expect(parseIncomingMessage("null")).toBeNull();
  });

  it("returns null for unknown type", () => {
    const line = JSON.stringify({ type: "unknown_type" });
    expect(parseIncomingMessage(line)).toBeNull();
  });

  it("returns null for agent_request without request_id", () => {
    const line = JSON.stringify({
      type: "agent_request",
      config: { prompt: "hello", apiKey: "sk-test", cwd: "/tmp" },
    });
    expect(parseIncomingMessage(line)).toBeNull();
  });

  it("returns null for agent_request with empty request_id", () => {
    const line = JSON.stringify({
      type: "agent_request",
      request_id: "",
      config: { prompt: "hello", apiKey: "sk-test", cwd: "/tmp" },
    });
    expect(parseIncomingMessage(line)).toBeNull();
  });

  it("returns null for agent_request without config", () => {
    const line = JSON.stringify({
      type: "agent_request",
      request_id: "req_1",
    });
    expect(parseIncomingMessage(line)).toBeNull();
  });

  it("returns null for agent_request with null config", () => {
    const line = JSON.stringify({
      type: "agent_request",
      request_id: "req_1",
      config: null,
    });
    expect(parseIncomingMessage(line)).toBeNull();
  });

  it("trims whitespace around the line", () => {
    const line =
      "  " +
      JSON.stringify({ type: "shutdown" }) +
      "  \n";
    const result = parseIncomingMessage(line);
    expect(result).toEqual({ type: "shutdown" });
  });
});

// =====================================================================
// Unit tests: wrapWithRequestId
// =====================================================================

describe("wrapWithRequestId", () => {
  it("adds request_id to a message", () => {
    const result = wrapWithRequestId("req_42", {
      type: "agent_message",
      content: "hello",
    });
    expect(result).toEqual({
      request_id: "req_42",
      type: "agent_message",
      content: "hello",
    });
  });

  it("request_id appears first in the object", () => {
    const result = wrapWithRequestId("req_1", { type: "result" });
    const keys = Object.keys(result);
    expect(keys[0]).toBe("request_id");
  });

  it("preserves all original fields", () => {
    const original = {
      type: "tool_use",
      name: "Read",
      input: { file: "test.ts" },
    };
    const result = wrapWithRequestId("req_5", original);
    expect(result).toMatchObject(original);
    expect(result.request_id).toBe("req_5");
  });
});

// =====================================================================
// Integration tests: runPersistent
// =====================================================================

/**
 * Helper: create a readable stream from an array of lines.
 * Each line is pushed as a separate chunk with a newline appended.
 */
function createInputStream(lines: string[]): Readable {
  const stream = new Readable({
    read() {
      for (const line of lines) {
        this.push(line + "\n");
      }
      this.push(null); // EOF
    },
  });
  return stream;
}

/**
 * Capture all writes to process.stdout during a function execution.
 */
function captureStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const mockWrite = vi.fn((chunk: string | Buffer) => {
    const str = typeof chunk === "string" ? chunk : chunk.toString();
    // Split by newlines in case multiple messages are in one write
    for (const line of str.split("\n")) {
      if (line.trim()) lines.push(line);
    }
    return true;
  });

  process.stdout.write = mockWrite as unknown as typeof process.stdout.write;

  return {
    lines,
    restore: () => {
      process.stdout.write = originalWrite;
    },
  };
}

describe("runPersistent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits sidecar_ready on startup", async () => {
    const input = createInputStream([JSON.stringify({ type: "shutdown" })]);
    const exitFn = vi.fn();
    const capture = captureStdout();

    try {
      await runPersistent(input, exitFn);
    } finally {
      capture.restore();
    }

    const readyLine = capture.lines.find((l) => {
      const parsed = JSON.parse(l);
      return parsed.type === "sidecar_ready";
    });
    expect(readyLine).toBeDefined();
    expect(JSON.parse(readyLine!)).toEqual({ type: "sidecar_ready" });
  });

  it("exits with code 0 on shutdown message", async () => {
    const input = createInputStream([JSON.stringify({ type: "shutdown" })]);
    const exitFn = vi.fn();
    const capture = captureStdout();

    try {
      await runPersistent(input, exitFn);
    } finally {
      capture.restore();
    }

    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it("exits with code 0 on stdin close (pipe broken)", async () => {
    // No shutdown message — just EOF
    const input = createInputStream([]);
    const exitFn = vi.fn();
    const capture = captureStdout();

    try {
      await runPersistent(input, exitFn);
    } finally {
      capture.restore();
    }

    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it("processes an agent_request and wraps responses with request_id", async () => {
    const sdkMessages = [
      { type: "agent_message", content: "thinking..." },
      { type: "result", content: "done", usage: { input: 100, output: 50 } },
    ];

    async function* fakeConversation() {
      for (const msg of sdkMessages) {
        yield msg;
      }
    }
    mockQuery.mockReturnValue(fakeConversation() as ReturnType<typeof query>);

    const config = {
      prompt: "test prompt",
      apiKey: "sk-test",
      cwd: "/tmp/test",
    };

    const input = createInputStream([
      JSON.stringify({
        type: "agent_request",
        request_id: "req_1",
        config,
      }),
      JSON.stringify({ type: "shutdown" }),
    ]);

    const exitFn = vi.fn();
    const capture = captureStdout();

    try {
      await runPersistent(input, exitFn);
    } finally {
      capture.restore();
    }

    // Filter out the sidecar_ready and system init lines
    const responseLinesRaw = capture.lines.filter((l) => {
      const parsed = JSON.parse(l);
      return parsed.type !== "sidecar_ready" && parsed.type !== "system";
    });

    expect(responseLinesRaw).toHaveLength(2);

    const msg0 = JSON.parse(responseLinesRaw[0]);
    expect(msg0.request_id).toBe("req_1");
    expect(msg0.type).toBe("agent_message");
    expect(msg0.content).toBe("thinking...");

    const msg1 = JSON.parse(responseLinesRaw[1]);
    expect(msg1.request_id).toBe("req_1");
    expect(msg1.type).toBe("result");
    expect(msg1.content).toBe("done");
  });

  it("handles SDK errors per-request without crashing", async () => {
    mockQuery.mockImplementation(() => {
      throw new Error("SDK connection failed");
    });

    const config = {
      prompt: "test prompt",
      apiKey: "sk-test",
      cwd: "/tmp/test",
    };

    const input = createInputStream([
      JSON.stringify({
        type: "agent_request",
        request_id: "req_err",
        config,
      }),
      JSON.stringify({ type: "shutdown" }),
    ]);

    const exitFn = vi.fn();
    const capture = captureStdout();

    try {
      await runPersistent(input, exitFn);
    } finally {
      capture.restore();
    }

    // Should get an error response wrapped with request_id
    const errorLine = capture.lines.find((l) => {
      const parsed = JSON.parse(l);
      return parsed.type === "error" && parsed.request_id;
    });
    expect(errorLine).toBeDefined();

    const errorMsg = JSON.parse(errorLine!);
    expect(errorMsg.request_id).toBe("req_err");
    expect(errorMsg.type).toBe("error");
    expect(errorMsg.message).toBe("SDK connection failed");

    // Process should still be running (exited only on shutdown)
    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it("handles multiple sequential requests", async () => {
    let callCount = 0;
    mockQuery.mockImplementation(() => {
      callCount++;
      const current = callCount;
      async function* fakeConversation() {
        yield { type: "result", content: `result_${current}` };
      }
      return fakeConversation() as ReturnType<typeof query>;
    });

    const config1 = { prompt: "first", apiKey: "sk-test", cwd: "/tmp" };
    const config2 = { prompt: "second", apiKey: "sk-test", cwd: "/tmp" };

    const input = createInputStream([
      JSON.stringify({
        type: "agent_request",
        request_id: "req_a",
        config: config1,
      }),
      JSON.stringify({
        type: "agent_request",
        request_id: "req_b",
        config: config2,
      }),
      JSON.stringify({ type: "shutdown" }),
    ]);

    const exitFn = vi.fn();
    const capture = captureStdout();

    try {
      await runPersistent(input, exitFn);
    } finally {
      capture.restore();
    }

    // Filter out sidecar_ready and system init events
    const responses = capture.lines
      .filter((l) => {
        const parsed = JSON.parse(l);
        return parsed.request_id && parsed.type !== "system";
      })
      .map((l) => JSON.parse(l));

    expect(responses).toHaveLength(2);
    expect(responses[0].request_id).toBe("req_a");
    expect(responses[0].content).toBe("result_1");
    expect(responses[1].request_id).toBe("req_b");
    expect(responses[1].content).toBe("result_2");
  });

  it("emits error for unrecognized input lines", async () => {
    const input = createInputStream([
      "this is not json",
      JSON.stringify({ type: "shutdown" }),
    ]);

    const exitFn = vi.fn();
    const capture = captureStdout();

    try {
      await runPersistent(input, exitFn);
    } finally {
      capture.restore();
    }

    const errorLine = capture.lines.find((l) => {
      const parsed = JSON.parse(l);
      return parsed.type === "error" && !parsed.request_id;
    });
    expect(errorLine).toBeDefined();

    const errorMsg = JSON.parse(errorLine!);
    expect(errorMsg.type).toBe("error");
    expect(errorMsg.message).toContain("Unrecognized input");
  });

  it("each response is a valid JSON line", async () => {
    async function* fakeConversation() {
      yield { type: "result", content: "done" };
    }
    mockQuery.mockReturnValue(fakeConversation() as ReturnType<typeof query>);

    const input = createInputStream([
      JSON.stringify({
        type: "agent_request",
        request_id: "req_json",
        config: { prompt: "test", apiKey: "sk-test", cwd: "/tmp" },
      }),
      JSON.stringify({ type: "shutdown" }),
    ]);

    const exitFn = vi.fn();
    const capture = captureStdout();

    try {
      await runPersistent(input, exitFn);
    } finally {
      capture.restore();
    }

    for (const line of capture.lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
