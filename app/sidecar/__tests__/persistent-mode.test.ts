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

  it("parses a valid ping message", () => {
    const line = JSON.stringify({ type: "ping" });
    const result = parseIncomingMessage(line);
    expect(result).toEqual({ type: "ping" });
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

  it("parses a valid cancel message", () => {
    const line = JSON.stringify({ type: "cancel", request_id: "req_1" });
    const result = parseIncomingMessage(line);
    expect(result).toEqual({ type: "cancel", request_id: "req_1" });
  });

  it("returns null for cancel without request_id", () => {
    const line = JSON.stringify({ type: "cancel" });
    expect(parseIncomingMessage(line)).toBeNull();
  });

  it("returns null for cancel with empty request_id", () => {
    const line = JSON.stringify({ type: "cancel", request_id: "" });
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

  // --- stream_start ---

  it("parses a valid stream_start", () => {
    const line = JSON.stringify({
      type: "stream_start",
      request_id: "req_1",
      session_id: "sess_1",
      config: { prompt: "hello", apiKey: "sk-test", cwd: "/tmp" },
    });
    const result = parseIncomingMessage(line);
    expect(result).toEqual({
      type: "stream_start",
      request_id: "req_1",
      session_id: "sess_1",
      config: { prompt: "hello", apiKey: "sk-test", cwd: "/tmp" },
    });
  });

  it("returns null for stream_start missing session_id", () => {
    const line = JSON.stringify({
      type: "stream_start",
      request_id: "req_1",
      config: { prompt: "hello", apiKey: "sk-test", cwd: "/tmp" },
    });
    expect(parseIncomingMessage(line)).toBeNull();
  });

  it("returns null for stream_start missing config", () => {
    const line = JSON.stringify({
      type: "stream_start",
      request_id: "req_1",
      session_id: "sess_1",
    });
    expect(parseIncomingMessage(line)).toBeNull();
  });

  // --- stream_message ---

  it("parses a valid stream_message", () => {
    const line = JSON.stringify({
      type: "stream_message",
      request_id: "req_2",
      session_id: "sess_1",
      user_message: "follow up",
    });
    const result = parseIncomingMessage(line);
    expect(result).toEqual({
      type: "stream_message",
      request_id: "req_2",
      session_id: "sess_1",
      user_message: "follow up",
    });
  });

  it("returns null for stream_message missing user_message", () => {
    const line = JSON.stringify({
      type: "stream_message",
      request_id: "req_2",
      session_id: "sess_1",
    });
    expect(parseIncomingMessage(line)).toBeNull();
  });

  // --- stream_end ---

  it("parses a valid stream_end", () => {
    const line = JSON.stringify({
      type: "stream_end",
      session_id: "sess_1",
    });
    const result = parseIncomingMessage(line);
    expect(result).toEqual({
      type: "stream_end",
      session_id: "sess_1",
    });
  });

  it("returns null for stream_end missing session_id", () => {
    const line = JSON.stringify({ type: "stream_end" });
    expect(parseIncomingMessage(line)).toBeNull();
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
    // Use proper SDK message shapes that MessageProcessor can process
    const sdkMessages = [
      {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "thinking..." }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      },
      { type: "result", subtype: "success", usage: { input_tokens: 100, output_tokens: 50 }, total_cost_usd: 0.01 },
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

    // Filter out the sidecar_ready, system init, and request_complete lines
    const responseLinesRaw = capture.lines.filter((l) => {
      const parsed = JSON.parse(l);
      return parsed.type !== "sidecar_ready" && parsed.type !== "system" && parsed.type !== "request_complete";
    });

    // Now we get: display_item(output), assistant(pass-through), display_item(result), result(pass-through)
    // Filter to just display_items for easy assertions
    const displayItemLines = responseLinesRaw.filter((l) => JSON.parse(l).type === "display_item");
    expect(displayItemLines.length).toBeGreaterThanOrEqual(2);

    const di0 = JSON.parse(displayItemLines[0]);
    expect(di0.request_id).toBe("req_1");
    expect(di0.type).toBe("display_item");
    expect(di0.item.type).toBe("output");
    expect(di0.item.outputText).toBe("thinking...");

    const di1 = JSON.parse(displayItemLines[1]);
    expect(di1.request_id).toBe("req_1");
    expect(di1.type).toBe("display_item");
    expect(di1.item.type).toBe("result");
    expect(di1.item.resultStatus).toBe("success");
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

  it("aborts a stuck request when a new one arrives", async () => {
    // The first request hangs until its AbortSignal fires.
    // When req_b arrives, persistent-mode should abort req_a and run req_b.
    let callCount = 0;
    mockQuery.mockImplementation((args: Record<string, unknown>) => {
      // Extract the abortController from options so the mock can simulate
      // real SDK behavior: abort causes the generator to throw.
      const opts = args.options as Record<string, unknown> | undefined;
      const ac = opts?.abortController as AbortController | undefined;
      callCount++;
      const current = callCount;
      async function* fakeConversation() {
        if (current === 1) {
          // Simulate a stuck API call — wait until abort signal fires
          await new Promise<void>((_, reject) => {
            if (ac?.signal.aborted) {
              reject(new Error("aborted"));
              return;
            }
            ac?.signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          });
        }
        yield { type: "result", content: `result_${current}` };
      }
      return fakeConversation() as ReturnType<typeof query>;
    });

    const config1 = { prompt: "first", apiKey: "sk-test", cwd: "/tmp" };
    const config2 = { prompt: "second", apiKey: "sk-test", cwd: "/tmp" };

    const { Readable } = await import("node:stream");
    const input = new Readable({ read() {} });

    const exitFn = vi.fn();
    const capture = captureStdout();

    const runPromise = runPersistent(input, exitFn);

    // Send first request (will hang)
    input.push(JSON.stringify({
      type: "agent_request",
      request_id: "req_a",
      config: config1,
    }) + "\n");
    await new Promise((r) => setTimeout(r, 20));

    // Send second request — should abort req_a and run req_b
    input.push(JSON.stringify({
      type: "agent_request",
      request_id: "req_b",
      config: config2,
    }) + "\n");
    await new Promise((r) => setTimeout(r, 20));

    // Shutdown
    input.push(JSON.stringify({ type: "shutdown" }) + "\n");
    input.push(null);
    await runPromise;

    capture.restore();

    // req_a should have a request_complete (from abort cleanup)
    const reqAComplete = capture.lines.find((l) => {
      const parsed = JSON.parse(l);
      return parsed.request_id === "req_a" && parsed.type === "request_complete";
    });
    expect(reqAComplete).toBeDefined();

    // req_b should have completed successfully — result is now an agent_event(run_result) or display_item
    const reqBResult = capture.lines.find((l) => {
      const parsed = JSON.parse(l);
      return parsed.request_id === "req_b"
        && ((parsed.type === "agent_event" && parsed.event?.type === "run_result") || parsed.type === "display_item");
    });
    expect(reqBResult).toBeDefined();

    // req_b should also have request_complete
    const reqBComplete = capture.lines.find((l) => {
      const parsed = JSON.parse(l);
      return parsed.request_id === "req_b" && parsed.type === "request_complete";
    });
    expect(reqBComplete).toBeDefined();

    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it("handles sequential requests when first completes before second arrives", async () => {
    let callCount = 0;
    mockQuery.mockImplementation(() => {
      callCount++;
      const current = callCount;
      async function* fakeConversation() {
        yield { type: "result", subtype: "success", result: `result_${current}`, usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.001 };
      }
      return fakeConversation() as ReturnType<typeof query>;
    });

    const config1 = { prompt: "first", apiKey: "sk-test", cwd: "/tmp" };
    const config2 = { prompt: "second", apiKey: "sk-test", cwd: "/tmp" };

    // Send requests one at a time with a gap so the first completes
    const { Readable } = await import("node:stream");
    const input = new Readable({ read() {} });

    const exitFn = vi.fn();
    const capture = captureStdout();

    const runPromise = runPersistent(input, exitFn);

    // Send first request and wait for it to complete
    input.push(JSON.stringify({
      type: "agent_request",
      request_id: "req_a",
      config: config1,
    }) + "\n");
    await new Promise((r) => setTimeout(r, 20));

    // Send second request after first is done
    input.push(JSON.stringify({
      type: "agent_request",
      request_id: "req_b",
      config: config2,
    }) + "\n");
    await new Promise((r) => setTimeout(r, 20));

    // Shutdown
    input.push(JSON.stringify({ type: "shutdown" }) + "\n");
    input.push(null);
    await runPromise;

    capture.restore();

    // Both requests should have succeeded — result messages are now agent_event(run_result)
    const runSummaries = capture.lines
      .filter((l) => {
        const parsed = JSON.parse(l);
        return parsed.request_id && parsed.type === "agent_event" && parsed.event?.type === "run_result";
      })
      .map((l) => JSON.parse(l));

    expect(runSummaries).toHaveLength(2);
    expect(runSummaries[0].request_id).toBe("req_a");
    expect(runSummaries[0].event).toHaveProperty("resultSubtype", "success");
    expect(runSummaries[1].request_id).toBe("req_b");
    expect(runSummaries[1].event).toHaveProperty("resultSubtype", "success");
    expect(exitFn).toHaveBeenCalledWith(0);
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

  it("responds to ping with pong", async () => {
    const input = createInputStream([
      JSON.stringify({ type: "ping" }),
      JSON.stringify({ type: "shutdown" }),
    ]);
    const exitFn = vi.fn();
    const capture = captureStdout();

    try {
      await runPersistent(input, exitFn);
    } finally {
      capture.restore();
    }

    const pongLine = capture.lines.find((l) => {
      const parsed = JSON.parse(l);
      return parsed.type === "pong";
    });
    expect(pongLine).toBeDefined();
    expect(JSON.parse(pongLine!)).toEqual({ type: "pong" });

    // Should still exit cleanly
    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it("cancel message aborts the matching in-flight request", async () => {
    // The request hangs until its AbortSignal fires (simulating a stuck SDK call).
    // Sending a cancel with the matching request_id should abort it.
    mockQuery.mockImplementation((args: Record<string, unknown>) => {
      const opts = args.options as Record<string, unknown> | undefined;
      const ac = opts?.abortController as AbortController | undefined;
      async function* fakeConversation() {
        // Wait until abort fires
        await new Promise<void>((_, reject) => {
          if (ac?.signal.aborted) {
            reject(new Error("aborted"));
            return;
          }
          ac?.signal.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        });
        yield { type: "result", content: "should not reach" };
      }
      return fakeConversation() as ReturnType<typeof query>;
    });

    const { Readable } = await import("node:stream");
    const input = new Readable({ read() {} });
    const exitFn = vi.fn();
    const capture = captureStdout();

    const runPromise = runPersistent(input, exitFn);

    // Send a request that will hang
    input.push(JSON.stringify({
      type: "agent_request",
      request_id: "req_stuck",
      config: { prompt: "test", apiKey: "sk-test", cwd: "/tmp" },
    }) + "\n");
    await new Promise((r) => setTimeout(r, 20));

    // Send cancel for that request
    input.push(JSON.stringify({
      type: "cancel",
      request_id: "req_stuck",
    }) + "\n");
    await new Promise((r) => setTimeout(r, 20));

    // Shutdown
    input.push(JSON.stringify({ type: "shutdown" }) + "\n");
    input.push(null);
    await runPromise;

    capture.restore();

    // The stuck request should have completed (via abort → shutdown summary → request_complete)
    const reqComplete = capture.lines.find((l) => {
      const parsed = JSON.parse(l);
      return parsed.request_id === "req_stuck" && parsed.type === "request_complete";
    });
    expect(reqComplete).toBeDefined();

    // Aborted requests should retain shutdown semantics, not execution-error semantics.
    const reqError = capture.lines.find((l) => {
      const parsed = JSON.parse(l);
      return parsed.request_id === "req_stuck" && parsed.type === "display_item" && parsed.item?.type === "error";
    });
    expect(reqError).toBeUndefined();

    const reqSummary = capture.lines.find((l) => {
      const parsed = JSON.parse(l);
      return parsed.request_id === "req_stuck" && parsed.type === "agent_event" && parsed.event?.type === "run_result";
    });
    expect(reqSummary).toBeDefined();
    expect(JSON.parse(reqSummary!).event.status).toBe("shutdown");
    expect(JSON.parse(reqSummary!).event.resultSubtype).toBeUndefined();

    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it("cancel message for non-matching request_id is ignored", async () => {
    mockQuery.mockImplementation((args: Record<string, unknown>) => {
      const opts = args.options as Record<string, unknown> | undefined;
      const ac = opts?.abortController as AbortController | undefined;
      async function* fakeConversation() {
        // Wait a bit to ensure cancel arrives while request is in-flight
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 50);
          ac?.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          }, { once: true });
        });
        yield { type: "result", content: "completed normally" };
      }
      return fakeConversation() as ReturnType<typeof query>;
    });

    const { Readable } = await import("node:stream");
    const input = new Readable({ read() {} });
    const exitFn = vi.fn();
    const capture = captureStdout();

    const runPromise = runPersistent(input, exitFn);

    // Send a request
    input.push(JSON.stringify({
      type: "agent_request",
      request_id: "req_real",
      config: { prompt: "test", apiKey: "sk-test", cwd: "/tmp" },
    }) + "\n");
    await new Promise((r) => setTimeout(r, 10));

    // Cancel a DIFFERENT request_id — should be ignored
    input.push(JSON.stringify({
      type: "cancel",
      request_id: "req_other",
    }) + "\n");
    await new Promise((r) => setTimeout(r, 80));

    // Shutdown
    input.push(JSON.stringify({ type: "shutdown" }) + "\n");
    input.push(null);
    await runPromise;

    capture.restore();

    // The real request should have completed normally (not aborted)
    // Result is now processed through MessageProcessor — look for agent_event(run_result) or display_item(result)
    const resultLine = capture.lines.find((l) => {
      const parsed = JSON.parse(l);
      return parsed.request_id === "req_real"
        && ((parsed.type === "agent_event" && parsed.event?.type === "run_result")
          || (parsed.type === "display_item" && parsed.item?.type === "result"));
    });
    expect(resultLine).toBeDefined();

    expect(exitFn).toHaveBeenCalledWith(0);
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

  it("supports stream_start and stream_message in MOCK_AGENTS mode", async () => {
    const originalMockAgents = process.env.MOCK_AGENTS;
    process.env.MOCK_AGENTS = "true";

    const { Readable } = await import("node:stream");
    const input = new Readable({ read() {} });
    const exitFn = vi.fn();
    const capture = captureStdout();

    try {
      const runPromise = runPersistent(input, exitFn);

      input.push(JSON.stringify({
        type: "stream_start",
        request_id: "req_stream_1",
        session_id: "sess_mock",
        config: { prompt: "initial stream prompt", apiKey: "sk-test", cwd: "/tmp" },
      }) + "\n");
      await new Promise((r) => setTimeout(r, 40));

      input.push(JSON.stringify({
        type: "stream_message",
        request_id: "req_stream_2",
        session_id: "sess_mock",
        user_message: "follow-up message",
      }) + "\n");
      await new Promise((r) => setTimeout(r, 40));

      input.push(JSON.stringify({ type: "stream_end", session_id: "sess_mock" }) + "\n");
      input.push(JSON.stringify({ type: "shutdown" }) + "\n");
      input.push(null);
      await runPromise;
    } finally {
      if (originalMockAgents === undefined) {
        delete process.env.MOCK_AGENTS;
      } else {
        process.env.MOCK_AGENTS = originalMockAgents;
      }
      capture.restore();
    }

    // Mock streaming now processes through MessageProcessor, so assistant messages
    // become display_item envelopes with output items (not raw assistant pass-throughs)
    const streamDisplayItems = capture.lines
      .map((l) => JSON.parse(l))
      .filter(
        (msg: Record<string, unknown>) => msg.type === "display_item"
          && (msg.request_id === "req_stream_1" || msg.request_id === "req_stream_2"),
      );
    expect(streamDisplayItems.length).toBeGreaterThanOrEqual(2);
    expect(
      streamDisplayItems.some((msg: Record<string, unknown>) => msg.request_id === "req_stream_1"),
    ).toBe(true);
    expect(
      streamDisplayItems.some((msg: Record<string, unknown>) => msg.request_id === "req_stream_2"),
    ).toBe(true);

    const turnCompleteForFollowUp = capture.lines
      .map((l) => JSON.parse(l))
      .some(
        (msg: Record<string, unknown>) =>
          msg.type === "agent_event" &&
          (msg.event as Record<string, unknown>)?.type === "turn_complete" &&
          msg.request_id === "req_stream_2",
      );
    expect(turnCompleteForFollowUp).toBe(true);
  });
});
