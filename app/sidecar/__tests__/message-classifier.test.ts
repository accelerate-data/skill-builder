import { describe, it, expect } from "vitest";
import { classifyRawMessage } from "../message-classifier.js";

describe("classifyRawMessage", () => {
  // --- hardNoise ---
  it("classifies config messages as system (forwarded for thinkingEnabled/agentName)", () => {
    expect(classifyRawMessage({ type: "config", config: {} })).toBe("system");
  });

  it("classifies sdk_stderr as hardNoise", () => {
    expect(
      classifyRawMessage({ type: "system", subtype: "sdk_stderr", data: "debug" }),
    ).toBe("hardNoise");
  });

  it("classifies sdk_plugins_debug as hardNoise", () => {
    expect(
      classifyRawMessage({ type: "system", subtype: "sdk_plugins_debug", plugins: [] }),
    ).toBe("hardNoise");
  });

  it("classifies turn_complete as hardNoise", () => {
    expect(classifyRawMessage({ type: "turn_complete" })).toBe("hardNoise");
  });

  it("classifies session_exhausted as hardNoise", () => {
    expect(classifyRawMessage({ type: "session_exhausted" })).toBe("hardNoise");
  });

  it("classifies request_complete as hardNoise", () => {
    expect(classifyRawMessage({ type: "request_complete" })).toBe("hardNoise");
  });

  it("classifies system without subtype as hardNoise", () => {
    expect(classifyRawMessage({ type: "system" })).toBe("hardNoise");
  });

  it("classifies unknown types as hardNoise", () => {
    expect(classifyRawMessage({ type: "pong" })).toBe("hardNoise");
  });

  it("classifies messages without type as hardNoise", () => {
    expect(classifyRawMessage({})).toBe("hardNoise");
  });

  // --- compact ---
  it("classifies compact_boundary as compact", () => {
    expect(
      classifyRawMessage({
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: { pre_tokens: 50000 },
      }),
    ).toBe("compact");
  });

  // --- system (init-progress) ---
  it("classifies init_start as system", () => {
    expect(
      classifyRawMessage({ type: "system", subtype: "init_start", timestamp: 0 }),
    ).toBe("system");
  });

  it("classifies sdk_ready as system", () => {
    expect(
      classifyRawMessage({ type: "system", subtype: "sdk_ready", timestamp: 0 }),
    ).toBe("system");
  });

  it("classifies init as system", () => {
    expect(
      classifyRawMessage({
        type: "system",
        subtype: "init",
        session_id: "sess-1",
        model: "claude-sonnet-4-20250514",
      }),
    ).toBe("system");
  });

  it("classifies unknown system subtypes as system", () => {
    expect(
      classifyRawMessage({ type: "system", subtype: "some_new_event" }),
    ).toBe("system");
  });

  // --- user ---
  it("classifies user messages as user", () => {
    expect(
      classifyRawMessage({
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu-1" }] },
      }),
    ).toBe("user");
  });

  // --- ai ---
  it("classifies assistant messages as ai", () => {
    expect(
      classifyRawMessage({
        type: "assistant",
        message: { content: [{ type: "text", text: "hello" }] },
      }),
    ).toBe("ai");
  });

  it("classifies result messages as ai", () => {
    expect(
      classifyRawMessage({
        type: "result",
        subtype: "success",
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    ).toBe("ai");
  });

  it("classifies error messages as ai", () => {
    expect(
      classifyRawMessage({ type: "error", error: "something failed" }),
    ).toBe("ai");
  });

  // --- auth_status (VU-531) ---
  it("classifies auth_status messages as ai", () => {
    expect(
      classifyRawMessage({
        type: "auth_status",
        isAuthenticating: false,
        output: [],
        error: "Invalid API key",
      }),
    ).toBe("ai");
  });

  it("classifies auth_status without error as ai", () => {
    expect(
      classifyRawMessage({
        type: "auth_status",
        isAuthenticating: true,
        output: ["Authenticating..."],
      }),
    ).toBe("ai");
  });
});
