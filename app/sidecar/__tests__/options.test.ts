import { describe, it, expect } from "vitest";
import { buildQueryOptions, buildHooks } from "../options.js";
import type { SidecarConfig } from "../config.js";

function makeConfig(overrides: Partial<SidecarConfig> = {}): SidecarConfig {
  return {
    prompt: "test prompt",
    apiKey: "sk-test",
    workspaceRootDir: "/tmp/project",
    workspaceSkillDir: "/tmp/project",
    ...overrides,
  };
}

describe("buildQueryOptions", () => {
  it("uses settingSources from config when provided as empty array", () => {
    // evaluate-skill passes settingSources: [] to block workspace skill loading
    const config = makeConfig({ agentName: "skill-creator:evaluate-skill", settingSources: [] });
    const opts = buildQueryOptions(config, new AbortController(), []);
    expect(opts.settingSources).toEqual([]);
  });

  it("defaults settingSources to ['project'] when absent from config", () => {
    const opts = buildQueryOptions(makeConfig(), new AbortController(), []);
    expect(opts.settingSources).toEqual(["project"]);
  });

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

  it("passes both agent and model when both agentName and model are present", () => {
    const config = makeConfig({
      agentName: "my-agent",
      model: "claude-sonnet-4-20250514",
    });
    const ac = new AbortController();
    const opts = buildQueryOptions(config, ac, []);

    expect(opts).toHaveProperty("agent", "my-agent");
    expect(opts).toHaveProperty("model", "claude-sonnet-4-20250514");
    expect(opts).toHaveProperty("settingSources", ["project"]);
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

  it("does not forward outputFormat to SDK (it stays as sidecar signal only)", () => {
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
    expect(opts).not.toHaveProperty("outputFormat");
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

  it("uses workspaceSkillDir as cwd", () => {
    const opts = buildQueryOptions(
      makeConfig({ workspaceSkillDir: "/my/project/skills/test" }),
      new AbortController(),
      []
    );
    expect(opts.cwd).toBe("/my/project/skills/test");
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

  it("does not include hooks when processorRef is not provided", () => {
    const opts = buildQueryOptions(
      makeConfig({ agentName: "skill-creator:generate-skill" }),
      new AbortController(),
      []
    );
    expect(opts).not.toHaveProperty("hooks");
  });

  it("includes SubagentStart and SubagentStop hooks when processorRef is provided", () => {
    const processorRef = { current: null };
    const opts = buildQueryOptions(
      makeConfig(),
      new AbortController(),
      [],
      undefined,
      processorRef,
    );
    expect(opts).toHaveProperty("hooks");
    const hooks = (opts as Record<string, unknown>).hooks as Record<string, unknown>;
    expect(hooks).not.toHaveProperty("Stop");
    expect(hooks).toHaveProperty("SubagentStart");
    expect(hooks).toHaveProperty("SubagentStop");
  });

  describe("buildHooks", () => {
    // Helper types for hook extraction
    type HookFn = (...args: unknown[]) => Promise<unknown>;
    type HookMatcher = { hooks: HookFn[] };

    function makeHooks() {
      const fakeProcessor = { pendingBackgroundTaskCount: 0 };
      const processorRef = { current: fakeProcessor as never };
      const result = buildHooks(processorRef);
      const hooks = result.hooks as Record<string, HookMatcher[]>;
      return {
        subagentStart: hooks.SubagentStart[0].hooks[0],
        subagentStop: hooks.SubagentStop[0].hooks[0],
        counter: result._subagentCounter,
      };
    }

    it("SubagentStart increments the hook counter", async () => {
      const { subagentStart, counter } = makeHooks();
      expect(counter.count).toBe(0);
      await subagentStart({ hook_event_name: "SubagentStart", agent_id: "a1", agent_type: "general" });
      expect(counter.count).toBe(1);
      await subagentStart({ hook_event_name: "SubagentStart", agent_id: "a2", agent_type: "general" });
      expect(counter.count).toBe(2);
    });

    it("SubagentStop decrements the hook counter", async () => {
      const { subagentStart, subagentStop, counter } = makeHooks();
      await subagentStart({ hook_event_name: "SubagentStart", agent_id: "a1", agent_type: "general" });
      await subagentStart({ hook_event_name: "SubagentStart", agent_id: "a2", agent_type: "general" });
      expect(counter.count).toBe(2);
      await subagentStop({ hook_event_name: "SubagentStop", agent_id: "a1", agent_type: "general" });
      expect(counter.count).toBe(1);
    });

    it("SubagentStop does not decrement below zero", async () => {
      const { subagentStop, counter } = makeHooks();
      expect(counter.count).toBe(0);
      await subagentStop({ hook_event_name: "SubagentStop", agent_id: "a1", agent_type: "general" });
      expect(counter.count).toBe(0);
    });
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
