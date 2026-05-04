import type { CanUseTool, HookInput, Options, SettingSource } from "@anthropic-ai/claude-agent-sdk";
import type { SidecarConfig } from "./config.js";
import type { MessageProcessor } from "./message-processor.js";

/**
 * Subagent lifecycle counter driven by SDK SubagentStart/SubagentStop hooks.
 * Exported for test access only — callers must not mutate directly.
 */
export interface SubagentCounter {
  readonly count: number;
}

/**
 * Environment variables safe to forward to the SDK child process.
 * Includes PATH/HOME for basic operation, proxy/TLS vars for corporate
 * networks, and locale vars for correct text handling.
 */
const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "TEMP",
  "TMP",
  "NODE_ENV",
  "NODE_PATH",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "XDG_RUNTIME_DIR",
  "LANG",
  "LC_ALL",
] as const;

function buildSafeEnv(apiKey: string): Record<string, string> {
  const env: Record<string, string> = { ANTHROPIC_API_KEY: apiKey };
  for (const key of ENV_ALLOWLIST) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  return env;
}

/**
 * Build the options object to pass to the SDK query() function.
 *
 * Agent / model resolution (settingSources: ['project'] always passed for project settings):
 *  - agentName only  → agent (front-matter model used as default)
 *  - model only      → model
 *  - both            → agent + explicit model (explicit model overrides front-matter)
 *
 * @param pluginPaths  Absolute paths to installed plugin directories discovered by the caller.
 *                     Each entry becomes { type: 'local', path } in the SDK plugins array.
 */
export function buildQueryOptions(
  config: SidecarConfig,
  abortController: AbortController,
  pluginPaths: string[],
  stderr?: (data: string) => void,
  processorRef?: { current: MessageProcessor | null },
  canUseTool?: CanUseTool,
) {
  // --- agent / model resolution ---
  const hasAgent = typeof config.agentName === "string" && config.agentName.length > 0;
  const agentField = hasAgent ? { agent: config.agentName } : {};
  const modelField = config.model ? { model: config.model } : {};

  // Pass the API key through the SDK's env option instead of mutating
  // process.env, which avoids races on concurrent requests.
  // Only allowlisted vars are forwarded to limit secret exposure.
  const envField = config.apiKey
    ? { env: buildSafeEnv(config.apiKey) }
    : {};

  const pluginsField = pluginPaths.length > 0
    ? { plugins: pluginPaths.map((p) => ({ type: "local" as const, path: p })) }
    : {};

  return {
    ...agentField,
    ...modelField,
    ...envField,
    ...pluginsField,
    // Load project settings from the skill workspace directory
    // (CLAUDE.md plus .claude/ skills/agents).
    // 'user' is intentionally excluded — it causes the SDK to scan
    // ~/.claude/skills/ (wasted reads) and the sidecar can't use the
    // user's MCP servers anyway (those are CLI-process-only).
    // When config.settingSources is [], workspace skills are suppressed so
    // plugin-scoped agents cannot load unrelated workspace skills.
    settingSources: (config.settingSources ?? ['project']) as SettingSource[],
    cwd: config.workspaceSkillDir,
    allowedTools: config.allowedTools,
    maxTurns: config.maxTurns ?? 50,
    permissionMode: (config.permissionMode || "bypassPermissions") as
      | "default"
      | "acceptEdits"
      | "bypassPermissions"
      | "plan",
    abortController,
    // Use the same Node binary that's running this sidecar process,
    // so any SDK-spawned Node tooling (e.g. MCP servers) uses a compatible runtime.
    executable: process.execPath as 'node',
    ...(config.pathToClaudeCodeExecutable
      ? { pathToClaudeCodeExecutable: config.pathToClaudeCodeExecutable }
      : {}),
    ...(config.betas ? { betas: config.betas as Options['betas'] } : {}),
    ...(config.thinking ? { thinking: config.thinking as Options["thinking"] } : {}),
    ...(config.effort ? { effort: config.effort as Options["effort"] } : {}),
    ...(config.fallbackModel ? { fallbackModel: config.fallbackModel } : {}),
    ...(config.systemPrompt ? { systemPrompt: config.systemPrompt } : {}),
    ...(typeof config.promptSuggestions === "boolean"
      ? { promptSuggestions: config.promptSuggestions }
      : {}),
    ...(stderr ? { stderr } : {}),
    ...(canUseTool ? { canUseTool } : {}),
    ...(processorRef ? buildHooks(processorRef) : {}),
  };
}

// ---------------------------------------------------------------------------
// Hook helpers
// ---------------------------------------------------------------------------

/**
 * Build SubagentStart, SubagentStop, and Stop hooks.
 *
 * Subagent counting is driven entirely by the SDK's SubagentStart/SubagentStop
 * hook events — NOT by MessageProcessor's display-item tracking.
 * Background-task counting still reads processorRef (not a hook event).
 *
 * Returns a `{ hooks, _subagentCounter }` object. `_subagentCounter` is
 * exposed exclusively for unit-test inspection.
 */
export function buildHooks(
  _processorRef: { current: MessageProcessor | null },
) {
  // SubagentStart/SubagentStop are logged for observability but no longer
  // drive the Stop hook — the SDK handles its own stop logic. The previous
  // Stop hook blocked termination based on a subagent counter that became
  // stale in multi-turn streaming sessions (counter grew but never shrank
  // when SubagentStop events were missed for nested subagents).
  const counter: { count: number } = { count: 0 };

  const hooks = {
    SubagentStart: [{
      hooks: [async (input: HookInput) => {
        counter.count += 1;
        const { agent_id, agent_type } = input as HookInput & { agent_id?: string; agent_type?: string };
        console.error(
          "[sidecar:hook] event=SubagentStart agent_id=%s agent_type=%s hook_subagent_count=%d",
          agent_id ?? "unknown",
          agent_type ?? "unknown",
          counter.count,
        );
        return { hookSpecificOutput: { hookEventName: "SubagentStart" as const } };
      }],
    }],
    SubagentStop: [{
      hooks: [async (input: HookInput) => {
        counter.count = Math.max(0, counter.count - 1);
        const { agent_id, agent_type } = input as HookInput & { agent_id?: string; agent_type?: string };
        console.error(
          "[sidecar:hook] event=SubagentStop agent_id=%s agent_type=%s hook_subagent_count=%d",
          agent_id ?? "unknown",
          agent_type ?? "unknown",
          counter.count,
        );
        return {};
      }],
    }],
  };

  return { hooks, _subagentCounter: counter as SubagentCounter };
}
