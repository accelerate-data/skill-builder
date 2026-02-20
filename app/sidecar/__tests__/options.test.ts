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
    const opts = buildQueryOptions(config, ac);

    expect(opts).toHaveProperty("agent", "my-agent");
    expect(opts).toHaveProperty("settingSources", ["project"]);
    expect(opts).not.toHaveProperty("model");
  });

  it("always includes claude_code system prompt preset", () => {
    const opts = buildQueryOptions(makeConfig(), new AbortController());
    expect(opts.systemPrompt).toEqual({ type: "preset", preset: "claude_code" });
  });

  it("uses model when agentName is absent", () => {
    const config = makeConfig({ model: "claude-sonnet-4-20250514" });
    const ac = new AbortController();
    const opts = buildQueryOptions(config, ac);

    expect(opts).toHaveProperty("model", "claude-sonnet-4-20250514");
    expect(opts).not.toHaveProperty("agent");
    expect(opts).toHaveProperty("settingSources", ["project"]);
  });

  it("passes both agent + model when both agentName and model are present (model overrides front-matter)", () => {
    const config = makeConfig({
      agentName: "my-agent",
      model: "claude-sonnet-4-20250514",
    });
    const ac = new AbortController();
    const opts = buildQueryOptions(config, ac);

    expect(opts).toHaveProperty("agent", "my-agent");
    expect(opts).toHaveProperty("settingSources", ["project"]);
    expect(opts).toHaveProperty("model", "claude-sonnet-4-20250514");
  });

  it("defaults maxTurns to 50 when not specified", () => {
    const opts = buildQueryOptions(makeConfig(), new AbortController());
    expect(opts.maxTurns).toBe(50);
  });

  it("uses provided maxTurns", () => {
    const opts = buildQueryOptions(
      makeConfig({ maxTurns: 10 }),
      new AbortController()
    );
    expect(opts.maxTurns).toBe(10);
  });

  it("defaults permissionMode to bypassPermissions", () => {
    const opts = buildQueryOptions(makeConfig(), new AbortController());
    expect(opts.permissionMode).toBe("bypassPermissions");
  });

  it("uses provided permissionMode", () => {
    const opts = buildQueryOptions(
      makeConfig({ permissionMode: "acceptEdits" }),
      new AbortController()
    );
    expect(opts.permissionMode).toBe("acceptEdits");
  });

  it("includes sessionId as resume when present", () => {
    const opts = buildQueryOptions(
      makeConfig({ sessionId: "sess-123" }),
      new AbortController()
    );
    expect(opts).toHaveProperty("resume", "sess-123");
  });

  it("excludes resume when sessionId is absent", () => {
    const opts = buildQueryOptions(makeConfig(), new AbortController());
    expect(opts).not.toHaveProperty("resume");
  });

  it("includes betas when present", () => {
    const opts = buildQueryOptions(
      makeConfig({ betas: ["beta-1", "beta-2"] }),
      new AbortController()
    );
    expect(opts).toHaveProperty("betas", ["beta-1", "beta-2"]);
  });

  it("excludes betas when absent", () => {
    const opts = buildQueryOptions(makeConfig(), new AbortController());
    expect(opts).not.toHaveProperty("betas");
  });

  it("includes pathToClaudeCodeExecutable when present", () => {
    const opts = buildQueryOptions(
      makeConfig({ pathToClaudeCodeExecutable: "/usr/local/bin/claude" }),
      new AbortController()
    );
    expect(opts).toHaveProperty(
      "pathToClaudeCodeExecutable",
      "/usr/local/bin/claude"
    );
  });

  it("excludes pathToClaudeCodeExecutable when absent", () => {
    const opts = buildQueryOptions(makeConfig(), new AbortController());
    expect(opts).not.toHaveProperty("pathToClaudeCodeExecutable");
  });

  it("includes allowedTools when present", () => {
    const opts = buildQueryOptions(
      makeConfig({ allowedTools: ["Read", "Write", "Bash"] }),
      new AbortController()
    );
    expect(opts.allowedTools).toEqual(["Read", "Write", "Bash"]);
  });

  it("passes the abort controller through", () => {
    const ac = new AbortController();
    const opts = buildQueryOptions(makeConfig(), ac);
    expect(opts.abortController).toBe(ac);
  });

  it("sets executable to process.execPath", () => {
    const opts = buildQueryOptions(makeConfig(), new AbortController());
    expect(opts.executable).toBe(process.execPath);
  });

  it("always includes cwd from config", () => {
    const opts = buildQueryOptions(
      makeConfig({ cwd: "/my/project" }),
      new AbortController()
    );
    expect(opts.cwd).toBe("/my/project");
  });

  it("passes stderr callback when provided", () => {
    const handler = (_data: string) => {};
    const opts = buildQueryOptions(makeConfig(), new AbortController(), handler);
    expect(opts.stderr).toBe(handler);
  });

  it("omits stderr when not provided", () => {
    const opts = buildQueryOptions(makeConfig(), new AbortController());
    expect(opts).not.toHaveProperty("stderr");
  });

  it("passes apiKey via env option when apiKey is present", () => {
    const opts = buildQueryOptions(
      makeConfig({ apiKey: "sk-test-key" }),
      new AbortController()
    );
    expect(opts).toHaveProperty("env");
    const env = (opts as Record<string, unknown>).env as Record<string, string | undefined>;
    expect(env.ANTHROPIC_API_KEY).toBe("sk-test-key");
  });

  it("omits env option when apiKey is empty", () => {
    const opts = buildQueryOptions(
      makeConfig({ apiKey: "" }),
      new AbortController()
    );
    expect(opts).not.toHaveProperty("env");
  });

});
