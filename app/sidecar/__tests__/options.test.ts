import { describe, it, expect } from "vitest";
import { buildQueryOptions } from "../options.js";
import type { SidecarConfig } from "../config.js";

function makeConfig(overrides: Partial<SidecarConfig> = {}): SidecarConfig {
  return {
    prompt: "test prompt",
    apiKey: "sk-test",
    cwd: "/tmp/project",
    ...overrides,
  };
}

describe("buildQueryOptions", () => {
  it("uses agent + settingSources when agentName is provided (no model)", () => {
    const config = makeConfig({ agentName: "my-agent" });
    const ac = new AbortController();
    const opts = buildQueryOptions(config, ac, []);

    expect(opts).toHaveProperty("agent", "my-agent");
    expect(opts).toHaveProperty("settingSources", ["project"]);
    expect(opts).not.toHaveProperty("model");
  });

  it("omits systemPrompt when none is provided", () => {
    const opts = buildQueryOptions(makeConfig(), new AbortController(), []);
    expect(opts).not.toHaveProperty("systemPrompt");
  });

  it("uses model when agentName is absent", () => {
    const config = makeConfig({ model: "claude-sonnet-4-20250514" });
    const ac = new AbortController();
    const opts = buildQueryOptions(config, ac, []);

    expect(opts).toHaveProperty("model", "claude-sonnet-4-20250514");
    expect(opts).not.toHaveProperty("agent");
    expect(opts).toHaveProperty("settingSources", ["project"]);
  });

  it("passes only agent when both agentName and model are present", () => {
    const config = makeConfig({
      agentName: "my-agent",
      model: "claude-sonnet-4-20250514",
    });
    const ac = new AbortController();
    const opts = buildQueryOptions(config, ac, []);

    expect(opts).toHaveProperty("agent", "my-agent");
    expect(opts).toHaveProperty("settingSources", ["project"]);
    expect(opts).not.toHaveProperty("model");
  });

  it("defaults maxTurns to 50 when not specified", () => {
    const opts = buildQueryOptions(makeConfig(), new AbortController(), []);
    expect(opts.maxTurns).toBe(50);
  });

  it("uses provided maxTurns", () => {
    const opts = buildQueryOptions(
      makeConfig({ maxTurns: 10 }),
      new AbortController(),
      []
    );
    expect(opts.maxTurns).toBe(10);
  });

  it("defaults permissionMode to bypassPermissions", () => {
    const opts = buildQueryOptions(makeConfig(), new AbortController(), []);
    expect(opts.permissionMode).toBe("bypassPermissions");
  });

  it("uses provided permissionMode", () => {
    const opts = buildQueryOptions(
      makeConfig({ permissionMode: "acceptEdits" }),
      new AbortController(),
      []
    );
    expect(opts.permissionMode).toBe("acceptEdits");
  });

  it("includes betas when present", () => {
    const opts = buildQueryOptions(
      makeConfig({ betas: ["beta-1", "beta-2"] }),
      new AbortController(),
      []
    );
    expect(opts).toHaveProperty("betas", ["beta-1", "beta-2"]);
  });

  it("excludes betas when absent", () => {
    const opts = buildQueryOptions(makeConfig(), new AbortController(), []);
    expect(opts).not.toHaveProperty("betas");
  });

  it("includes thinking when present", () => {
    const opts = buildQueryOptions(
      makeConfig({ thinking: { type: "enabled", budgetTokens: 16000 } }),
      new AbortController(),
      []
    );
    expect(opts).toHaveProperty("thinking");
  });

  it("excludes thinking when absent", () => {
    const opts = buildQueryOptions(makeConfig(), new AbortController(), []);
    expect(opts).not.toHaveProperty("thinking");
  });

  it("includes effort when present", () => {
    const opts = buildQueryOptions(
      makeConfig({ effort: "high" }),
      new AbortController(),
      []
    );
    expect(opts).toHaveProperty("effort", "high");
  });

  it("includes fallbackModel when present", () => {
    const opts = buildQueryOptions(
      makeConfig({ fallbackModel: "claude-sonnet-4-6" }),
      new AbortController(),
      []
    );
    expect(opts).toHaveProperty("fallbackModel", "claude-sonnet-4-6");
  });

  it("includes outputFormat when present", () => {
    const opts = buildQueryOptions(
      makeConfig({
        outputFormat: {
          type: "json_schema",
          schema: { type: "object", properties: { ok: { type: "boolean" } } },
        },
      }),
      new AbortController(),
      []
    );
    expect(opts).toHaveProperty("outputFormat");
  });

  it("includes promptSuggestions when explicitly set", () => {
    const opts = buildQueryOptions(
      makeConfig({ promptSuggestions: true }),
      new AbortController(),
      []
    );
    expect(opts).toHaveProperty("promptSuggestions", true);
  });

  it("includes pathToClaudeCodeExecutable when present", () => {
    const opts = buildQueryOptions(
      makeConfig({ pathToClaudeCodeExecutable: "/usr/local/bin/claude" }),
      new AbortController(),
      []
    );
    expect(opts).toHaveProperty(
      "pathToClaudeCodeExecutable",
      "/usr/local/bin/claude"
    );
  });

  it("excludes pathToClaudeCodeExecutable when absent", () => {
    const opts = buildQueryOptions(makeConfig(), new AbortController(), []);
    expect(opts).not.toHaveProperty("pathToClaudeCodeExecutable");
  });

  it("includes allowedTools when present", () => {
    const opts = buildQueryOptions(
      makeConfig({ allowedTools: ["Read", "Write", "Bash"] }),
      new AbortController(),
      []
    );
    expect(opts.allowedTools).toEqual(["Read", "Write", "Bash"]);
  });

  it("passes the abort controller through", () => {
    const ac = new AbortController();
    const opts = buildQueryOptions(makeConfig(), ac, []);
    expect(opts.abortController).toBe(ac);
  });

  it("sets executable to process.execPath", () => {
    const opts = buildQueryOptions(makeConfig(), new AbortController(), []);
    expect(opts.executable).toBe(process.execPath);
  });

  it("always includes cwd from config", () => {
    const opts = buildQueryOptions(
      makeConfig({ cwd: "/my/project" }),
      new AbortController(),
      []
    );
    expect(opts.cwd).toBe("/my/project");
  });

  it("passes stderr callback when provided", () => {
    const handler = (_data: string) => {};
    const opts = buildQueryOptions(makeConfig(), new AbortController(), [], handler);
    expect(opts.stderr).toBe(handler);
  });

  it("omits stderr when not provided", () => {
    const opts = buildQueryOptions(makeConfig(), new AbortController(), []);
    expect(opts).not.toHaveProperty("stderr");
  });

  it("passes apiKey via env option when apiKey is present", () => {
    const opts = buildQueryOptions(
      makeConfig({ apiKey: "sk-test-key" }),
      new AbortController(),
      []
    );
    expect(opts).toHaveProperty("env");
    const env = (opts as Record<string, unknown>).env as Record<string, string | undefined>;
    expect(env.ANTHROPIC_API_KEY).toBe("sk-test-key");
  });

  it("omits env option when apiKey is empty", () => {
    const opts = buildQueryOptions(
      makeConfig({ apiKey: "" }),
      new AbortController(),
      []
    );
    expect(opts).not.toHaveProperty("env");
  });

  it("omits plugins when pluginPaths is empty", () => {
    const opts = buildQueryOptions(makeConfig(), new AbortController(), []);
    expect(opts).not.toHaveProperty("plugins");
  });

  it("builds plugins array from provided absolute paths", () => {
    const opts = buildQueryOptions(
      makeConfig(),
      new AbortController(),
      [
        "/workspace/.claude/plugins/skill-content-researcher",
        "/workspace/.claude/plugins/skill-creator",
      ]
    );
    expect(opts).toHaveProperty("plugins");
    const plugins = (opts as Record<string, unknown>).plugins as Array<{ type: string; path: string }>;
    expect(plugins).toHaveLength(2);
    expect(plugins[0]).toEqual({ type: "local", path: "/workspace/.claude/plugins/skill-content-researcher" });
    expect(plugins[1]).toEqual({ type: "local", path: "/workspace/.claude/plugins/skill-creator" });
  });

  it("env contains only allowlisted vars plus ANTHROPIC_API_KEY", () => {
    // Set a non-allowlisted var to verify it is excluded
    const originalSecret = process.env.SECRET_KEY;
    process.env.SECRET_KEY = "should-not-leak";
    try {
      const opts = buildQueryOptions(
        makeConfig({ apiKey: "sk-test-key" }),
        new AbortController(),
        []
      );
      const env = (opts as Record<string, unknown>).env as Record<string, string | undefined>;
      expect(env.ANTHROPIC_API_KEY).toBe("sk-test-key");
      expect(env.SECRET_KEY).toBeUndefined();
      // PATH should be forwarded if present in process.env
      if (process.env.PATH) {
        expect(env.PATH).toBe(process.env.PATH);
      }
    } finally {
      if (originalSecret === undefined) {
        delete process.env.SECRET_KEY;
      } else {
        process.env.SECRET_KEY = originalSecret;
      }
    }
  });

});
