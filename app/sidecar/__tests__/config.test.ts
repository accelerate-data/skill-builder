import os from "os";
import { describe, it, expect } from "vitest";
import { parseSidecarConfig, redactConfig } from "../config.js";

const TEST_CWD = os.tmpdir();

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
      parseSidecarConfig({ apiKey: "key", workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD })
    ).toThrow("Invalid SidecarConfig: missing prompt");
  });

  it("throws when apiKey is missing", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD })
    ).toThrow("Invalid SidecarConfig: missing apiKey");
  });

  it("throws when apiKey is empty string", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "", workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD })
    ).toThrow("Invalid SidecarConfig: missing apiKey");
  });

  it("throws when workspaceRootDir is missing", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "key", workspaceSkillDir: TEST_CWD })
    ).toThrow("Invalid SidecarConfig: missing workspaceRootDir");
  });

  it("throws when workspaceSkillDir is missing", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "key", workspaceRootDir: TEST_CWD })
    ).toThrow("Invalid SidecarConfig: missing workspaceSkillDir");
  });

  it("throws when requiredPlugins contains non-string", () => {
    expect(() =>
      parseSidecarConfig({ prompt: "hello", apiKey: "key", workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD, requiredPlugins: [1, 2] })
    ).toThrow("Invalid SidecarConfig: requiredPlugins must be string[]");
  });

  it("accepts valid config with all required fields", () => {
    const result = parseSidecarConfig({ prompt: "hello", apiKey: "key", workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD });
    expect(result.prompt).toBe("hello");
    expect(result.apiKey).toBe("key");
    expect(result.workspaceRootDir).toBe(TEST_CWD);
    expect(result.workspaceSkillDir).toBe(TEST_CWD);
  });

  it("accepts valid config with optional requiredPlugins", () => {
    const result = parseSidecarConfig({
      prompt: "hello",
      apiKey: "key",
      workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD,
      requiredPlugins: ["computer", "bash"],
    });
    expect(result.requiredPlugins).toEqual(["computer", "bash"]);
  });

  it("accepts explicit one-shot mode", () => {
    const result = parseSidecarConfig({
      prompt: "hello",
      apiKey: "key",
      workspaceRootDir: TEST_CWD,
      workspaceSkillDir: TEST_CWD,
      pluginSlug: "demo",
      mode: "one-shot",
    });

    expect(result.mode).toBe("one-shot");
  });

  it("accepts scope review task metadata for OpenHands requests", () => {
    const result = parseSidecarConfig({
      prompt: "review this scope",
      apiKey: "key",
      workspaceRootDir: TEST_CWD,
      workspaceSkillDir: TEST_CWD,
      pluginSlug: "demo",
      runtimeProvider: "openhands",
      mode: "one-shot",
      agentName: "skill-creator",
      taskKind: "scope_review",
      userMessageSuffix: "Follow the current user message exactly.",
      llm: {
        model: "claude-sonnet-4-5",
      },
    });

    expect(result.taskKind).toBe("scope_review");
    expect(result.userMessageSuffix).toBe(
      "Follow the current user message exactly.",
    );
    expect(result.agentName).toBe("skill-creator");
  });

  it("validates taskKind and userMessageSuffix as optional strings", () => {
    const baseConfig = {
      prompt: "review this scope",
      apiKey: "key",
      workspaceRootDir: TEST_CWD,
      workspaceSkillDir: TEST_CWD,
      pluginSlug: "demo",
      runtimeProvider: "openhands",
      llm: {
        model: "claude-sonnet-4-5",
      },
    };

    expect(() =>
      parseSidecarConfig({ ...baseConfig, taskKind: 42 }),
    ).toThrow("taskKind must be a string");
    expect(() =>
      parseSidecarConfig({ ...baseConfig, userMessageSuffix: 42 }),
    ).toThrow("userMessageSuffix must be a string");
  });

  it("throws when mode is invalid", () => {
    expect(() =>
      parseSidecarConfig({
        prompt: "hello",
        apiKey: "key",
        workspaceRootDir: TEST_CWD,
        workspaceSkillDir: TEST_CWD,
        pluginSlug: "demo",
        mode: "interactive",
      }),
    ).toThrow("mode must be one of");
  });

  it("accepts empty string workspace dirs (no strict validation)", () => {
    // workspace dirs are type-checked but not value-validated — empty string passes.
    // Callers are responsible for providing valid directories.
    const result = parseSidecarConfig({ prompt: "hello", apiKey: "key", workspaceRootDir: "", workspaceSkillDir: "" });
    expect(result.workspaceRootDir).toBe("");
    expect(result.workspaceSkillDir).toBe("");
  });

  it("passes through extra unknown fields", () => {
    // The parser casts `raw as SidecarConfig` without stripping extra keys.
    // This is intentional: the sidecar may forward fields to the agent runtime.
    const result = parseSidecarConfig({
      prompt: "hello",
      apiKey: "key",
      workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD,
      extraField: "should survive",
    });
    expect((result as Record<string, unknown>).extraField).toBe("should survive");
  });

  // --- Optional field validation (VU-583) ---

  it("throws when model is not a string", () => {
    expect(() =>

      parseSidecarConfig({ prompt: "hello", apiKey: "key", workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD, model: 123 })
    ).toThrow("model must be a string");
  });

  it("throws when modelBaseUrl is not a string", () => {
    expect(() =>
      parseSidecarConfig({
        prompt: "hello",
        apiKey: "key",
        workspaceRootDir: TEST_CWD,
        workspaceSkillDir: TEST_CWD,
        modelBaseUrl: 123,
      }),
    ).toThrow("modelBaseUrl must be a string");
  });

  it("throws when maxTurns is not a positive integer", () => {
    expect(() =>

      parseSidecarConfig({ prompt: "hello", apiKey: "key", workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD, maxTurns: "fifty" })
    ).toThrow("maxTurns must be a positive integer");
  });

  it("throws when maxTurns is zero", () => {
    expect(() =>

      parseSidecarConfig({ prompt: "hello", apiKey: "key", workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD, maxTurns: 0 })
    ).toThrow("maxTurns must be a positive integer");
  });

  it("throws when maxTurns is negative", () => {
    expect(() =>

      parseSidecarConfig({ prompt: "hello", apiKey: "key", workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD, maxTurns: -5 })
    ).toThrow("maxTurns must be a positive integer");
  });

  it("throws when permissionMode is invalid", () => {
    expect(() =>

      parseSidecarConfig({ prompt: "hello", apiKey: "key", workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD, permissionMode: "yolo" })
    ).toThrow("permissionMode must be one of");
  });

  it("throws when effort is invalid", () => {
    expect(() =>

      parseSidecarConfig({ prompt: "hello", apiKey: "key", workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD, effort: "extreme" })
    ).toThrow("effort must be one of");
  });

  it("throws when runSource is invalid", () => {
    expect(() =>

      parseSidecarConfig({ prompt: "hello", apiKey: "key", workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD, runSource: "deploy" })
    ).toThrow("runSource must be one of");
  });

  it("throws when stepId is not a number", () => {
    expect(() =>

      parseSidecarConfig({ prompt: "hello", apiKey: "key", workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD, stepId: "two" })
    ).toThrow("stepId must be a number");
  });

  it("throws when promptSuggestions is not a boolean", () => {
    expect(() =>

      parseSidecarConfig({ prompt: "hello", apiKey: "key", workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD, promptSuggestions: "yes" })
    ).toThrow("promptSuggestions must be a boolean");
  });

  it("throws when allowedTools is not a string array", () => {
    expect(() =>

      parseSidecarConfig({ prompt: "hello", apiKey: "key", workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD, allowedTools: [1, 2] })
    ).toThrow("allowedTools must be string[]");
  });

  it("throws when betas is not a string array", () => {
    expect(() =>

      parseSidecarConfig({ prompt: "hello", apiKey: "key", workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD, betas: [true] })
    ).toThrow("betas must be string[]");
  });

  it("throws when thinking is not an object", () => {
    expect(() =>

      parseSidecarConfig({ prompt: "hello", apiKey: "key", workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD, thinking: "enabled" })
    ).toThrow("thinking must be an object");
  });

  it("throws when thinking.type is invalid", () => {
    expect(() =>

      parseSidecarConfig({ prompt: "hello", apiKey: "key", workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD, thinking: { type: "turbo" } })
    ).toThrow("thinking.type must be disabled, adaptive, or enabled");
  });

  it("throws when thinking.budgetTokens is not a number", () => {
    expect(() =>

      parseSidecarConfig({ prompt: "hello", apiKey: "key", workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD, thinking: { type: "enabled", budgetTokens: "lots" } })
    ).toThrow("thinking.budgetTokens must be a number");
  });

  it("accepts openhands as a valid runtimeProvider", () => {
    const baseConfig = {
      prompt: "hello",
      apiKey: "key",
      workspaceRootDir: TEST_CWD,
      workspaceSkillDir: TEST_CWD,
    };
    expect(
      parseSidecarConfig({
        ...baseConfig,
        runtimeProvider: "openhands",
      }).runtimeProvider,
    ).toBe("openhands");
  });

  it("validates openhands llm fields", () => {
    const baseConfig = { prompt: "hello", apiKey: "key", workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD, runtimeProvider: "openhands" };
    expect(() => parseSidecarConfig({ ...baseConfig, llm: { apiKey: "sk-test" } })).toThrow(
      "Invalid SidecarConfig: llm.model must be a string",
    );
    expect(() => parseSidecarConfig({ ...baseConfig, llm: { model: "claude-sonnet-4-5", timeoutSeconds: 0 } })).toThrow(
      "Invalid SidecarConfig: llm.timeoutSeconds must be a positive integer",
    );
    expect(() => parseSidecarConfig({ ...baseConfig, llm: { model: "claude-sonnet-4-5", reasoningEffort: "max" } })).toThrow(
      "Invalid SidecarConfig: llm.reasoningEffort must be one of auto, low, medium, high",
    );
  });

  it("throws when runtimeProvider is invalid", () => {
    const baseConfig = { prompt: "hello", apiKey: "key", workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD };
    expect(() => parseSidecarConfig({ ...baseConfig, runtimeProvider: "bad" })).toThrow(
      "Invalid SidecarConfig: runtimeProvider must be one of claude, openhands",
    );
  });

  it("accepts valid config with all optional fields", () => {
    const result = parseSidecarConfig({
      prompt: "hello",
      apiKey: "key",

      workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD,
      model: "claude-sonnet-4-6",
      llm: {
        model: "claude-sonnet-4-5",
        apiKey: "sk-llm",
        baseUrl: "https://models.example.com/v1",
        apiVersion: "2024-10-01",
        temperature: 0.2,
        maxOutputTokens: 4096,
        timeoutSeconds: 300,
        numRetries: 5,
        reasoningEffort: "high",
        extraHeaders: { "x-provider-routing": "secure-route" },
        inputCostPerToken: 0.000003,
        outputCostPerToken: 0.000015,
        usageId: "workflow",
      },
      modelBaseUrl: "https://models.example.com/v1",
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
    expect(result.llm?.model).toBe("claude-sonnet-4-5");
    expect(result.modelBaseUrl).toBe("https://models.example.com/v1");
    expect(result.maxTurns).toBe(50);
  });
});

// --- redactConfig ---

describe("redactConfig", () => {
  it("redacts apiKey", () => {

    const config = parseSidecarConfig({ prompt: "hello", apiKey: "sk-secret-key", workspaceRootDir: TEST_CWD, workspaceSkillDir: TEST_CWD });
    const redacted = redactConfig(config);
    expect(redacted.apiKey).toBe("[REDACTED]");
    expect(redacted.prompt).toBe("hello");
    expect(redacted.workspaceRootDir).toBe(TEST_CWD);
  });

  it("redacts llm apiKey and extra header values", () => {
    const config = parseSidecarConfig({
      prompt: "hello",
      apiKey: "sk-secret-key",
      workspaceRootDir: TEST_CWD,
      workspaceSkillDir: TEST_CWD,
      runtimeProvider: "openhands",
      llm: {
        model: "claude-sonnet-4-5",
        apiKey: "sk-llm-secret",
        extraHeaders: {
          "x-provider-routing": "secure-route",
        },
      },
    });
    const redacted = redactConfig(config);
    expect((redacted.llm as Record<string, unknown>).apiKey).toBe("[REDACTED]");
    expect(
      ((redacted.llm as Record<string, unknown>).extraHeaders as Record<string, unknown>)["x-provider-routing"],
    ).toBe("[REDACTED]");
  });
});
