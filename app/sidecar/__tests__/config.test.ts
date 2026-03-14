import { describe, it, expect } from "vitest";
import { parseSidecarConfig, redactConfig } from "../config.js";

describe("parseSidecarConfig", () => {
  it("throws on null", () => {
    expect(() => parseSidecarConfig(null)).toThrow("Invalid SidecarConfig: expected object");
  });

  it("throws on non-object", () => {
    expect(() => parseSidecarConfig("string")).toThrow("Invalid SidecarConfig: expected object");
    expect(() => parseSidecarConfig(42)).toThrow("Invalid SidecarConfig: expected object");
  });

  it("throws when prompt is missing", () => {
    expect(() =>
      parseSidecarConfig({ apiKey: "key", cwd: "/tmp" })
    ).toThrow("Invalid SidecarConfig: missing prompt");
  });

  it("throws when apiKey is missing", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", cwd: "/tmp" })
    ).toThrow("Invalid SidecarConfig: missing apiKey");
  });

  it("throws when apiKey is empty string", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "", cwd: "/tmp" })
    ).toThrow("Invalid SidecarConfig: missing apiKey");
  });

  it("throws when cwd is missing", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "key" })
    ).toThrow("Invalid SidecarConfig: missing cwd");
  });

  it("throws when requiredPlugins contains non-string", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "key", cwd: "/tmp", requiredPlugins: [1, 2] })
    ).toThrow("Invalid SidecarConfig: requiredPlugins must be string[]");
  });

  it("accepts valid config with all required fields", () => {
    const result = parseSidecarConfig({ prompt: "hello", apiKey: "key", cwd: "/tmp" });
    expect(result.prompt).toBe("hello");
    expect(result.apiKey).toBe("key");
    expect(result.cwd).toBe("/tmp");
  });

  it("accepts valid config with optional requiredPlugins", () => {
    const result = parseSidecarConfig({
      prompt: "hello",
      apiKey: "key",
      cwd: "/tmp",
      requiredPlugins: ["computer", "bash"],
    });
    expect(result.requiredPlugins).toEqual(["computer", "bash"]);
  });

  it("accepts empty string cwd (no strict validation)", () => {
    // cwd is type-checked but not value-validated — empty string passes.
    // Callers are responsible for providing a valid directory.
    const result = parseSidecarConfig({ prompt: "hello", apiKey: "key", cwd: "" });
    expect(result.cwd).toBe("");
  });

  it("passes through extra unknown fields", () => {
    // The parser casts `raw as SidecarConfig` without stripping extra keys.
    // This is intentional: the sidecar may forward fields to the agent runtime.
    const result = parseSidecarConfig({
      prompt: "hello",
      apiKey: "key",
      cwd: "/tmp",
      extraField: "should survive",
    });
    expect((result as Record<string, unknown>).extraField).toBe("should survive");
  });

  // --- Optional field validation (VU-583) ---

  it("throws when model is not a string", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "key", cwd: "/tmp", model: 123 })
    ).toThrow("model must be a string");
  });

  it("throws when maxTurns is not a positive integer", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "key", cwd: "/tmp", maxTurns: "fifty" })
    ).toThrow("maxTurns must be a positive integer");
  });

  it("throws when maxTurns is zero", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "key", cwd: "/tmp", maxTurns: 0 })
    ).toThrow("maxTurns must be a positive integer");
  });

  it("throws when maxTurns is negative", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "key", cwd: "/tmp", maxTurns: -5 })
    ).toThrow("maxTurns must be a positive integer");
  });

  it("throws when permissionMode is invalid", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "key", cwd: "/tmp", permissionMode: "yolo" })
    ).toThrow("permissionMode must be one of");
  });

  it("throws when effort is invalid", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "key", cwd: "/tmp", effort: "extreme" })
    ).toThrow("effort must be one of");
  });

  it("throws when runSource is invalid", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "key", cwd: "/tmp", runSource: "deploy" })
    ).toThrow("runSource must be one of");
  });

  it("throws when stepId is not a number", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "key", cwd: "/tmp", stepId: "two" })
    ).toThrow("stepId must be a number");
  });

  it("throws when promptSuggestions is not a boolean", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "key", cwd: "/tmp", promptSuggestions: "yes" })
    ).toThrow("promptSuggestions must be a boolean");
  });

  it("throws when allowedTools is not a string array", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "key", cwd: "/tmp", allowedTools: [1, 2] })
    ).toThrow("allowedTools must be string[]");
  });

  it("throws when betas is not a string array", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "key", cwd: "/tmp", betas: [true] })
    ).toThrow("betas must be string[]");
  });

  it("throws when thinking is not an object", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "key", cwd: "/tmp", thinking: "enabled" })
    ).toThrow("thinking must be an object");
  });

  it("throws when thinking.type is invalid", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "key", cwd: "/tmp", thinking: { type: "turbo" } })
    ).toThrow("thinking.type must be disabled, adaptive, or enabled");
  });

  it("throws when thinking.budgetTokens is not a number", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "key", cwd: "/tmp", thinking: { type: "enabled", budgetTokens: "lots" } })
    ).toThrow("thinking.budgetTokens must be a number");
  });

  it("accepts valid config with all optional fields", () => {
    const result = parseSidecarConfig({
      prompt: "hello",
      apiKey: "key",
      cwd: "/tmp",
      model: "claude-sonnet-4-6",
      agentName: "my-agent",
      maxTurns: 50,
      permissionMode: "bypassPermissions",
      effort: "high",
      runSource: "workflow",
      stepId: 2,
      skillName: "test-skill",
      promptSuggestions: false,
      allowedTools: ["Read", "Write"],
      betas: ["beta-1"],
      thinking: { type: "enabled", budgetTokens: 16000 },
      fallbackModel: "claude-haiku-4-5",
      workflowSessionId: "sess-123",
      usageSessionId: "usage-456",
    });
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.maxTurns).toBe(50);
  });
});

// --- redactConfig ---

describe("redactConfig", () => {
  it("redacts apiKey", () => {
    const config = parseSidecarConfig({ prompt: "hello", apiKey: "sk-secret-key", cwd: "/tmp" });
    const redacted = redactConfig(config);
    expect(redacted.apiKey).toBe("[REDACTED]");
    expect(redacted.prompt).toBe("hello");
    expect(redacted.cwd).toBe("/tmp");
  });
});
