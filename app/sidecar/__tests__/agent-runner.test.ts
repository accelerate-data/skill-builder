import { describe, it, expect } from "vitest";

import { type SidecarConfig } from "../config.js";
import { buildQueryOptions } from "../options.js";

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
    expect(opts).toHaveProperty("settingSources", ["project", "user"]);
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
    expect(opts).toHaveProperty("settingSources", ["project", "user"]);
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
    expect(opts).toHaveProperty("settingSources", ["project", "user"]);
    expect(opts).toHaveProperty("model", "claude-haiku-4-20250414");
  });

  it("neither agent nor model: settingSources always present, no agent/model", () => {
    const abortController = new AbortController();
    const opts = buildQueryOptions(baseConfig(), abortController);

    expect(opts).not.toHaveProperty("agent");
    expect(opts).toHaveProperty("settingSources", ["project", "user"]);
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
