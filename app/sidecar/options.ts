import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { SidecarConfig } from "./config.js";

/**
 * Build the options object to pass to the SDK query() function.
 *
 * Agent / model resolution (settingSources: ['project'] always passed for project settings):
 *  - agentName only  → agent (front-matter model used)
 *  - model only      → model
 *  - both            → agent only (front-matter model authoritative)
 *
 * @param pluginPaths  Absolute paths to installed plugin directories discovered by the caller.
 *                     Each entry becomes { type: 'local', path } in the SDK plugins array.
 */
export function buildQueryOptions(
  config: SidecarConfig,
  abortController: AbortController,
  pluginPaths: string[],
  stderr?: (data: string) => void,
) {
  // --- agent / model resolution ---
  const hasAgent = typeof config.agentName === "string" && config.agentName.length > 0;
  const agentField = hasAgent ? { agent: config.agentName } : {};
  const modelField = !hasAgent && config.model ? { model: config.model } : {};

  // Pass the API key through the SDK's env option instead of mutating
  // process.env, which avoids races on concurrent requests.
  const envField = config.apiKey
    ? { env: { ...process.env, ANTHROPIC_API_KEY: config.apiKey } }
    : {};

  const pluginsField = pluginPaths.length > 0
    ? { plugins: pluginPaths.map((p) => ({ type: "local" as const, path: p })) }
    : {};

  return {
    ...agentField,
    ...modelField,
    ...envField,
    ...pluginsField,
    // Load project settings from the project workspace at {cwd}
    // (workspace-root CLAUDE.md plus .claude/ skills/agents).
    // 'user' is intentionally excluded — it causes the SDK to scan
    // ~/.claude/skills/ (wasted reads) and the sidecar can't use the
    // user's MCP servers anyway (those are CLI-process-only).
    settingSources: ['project' as const],
    cwd: config.cwd,
    allowedTools: config.allowedTools,
    maxTurns: config.maxTurns ?? 50,
    permissionMode: (config.permissionMode || "bypassPermissions") as
      | "default"
      | "acceptEdits"
      | "bypassPermissions"
      | "plan",
    abortController,
    // Use the same Node binary that's running this sidecar process,
    // so the SDK spawns cli.js with a compatible Node version.
    executable: process.execPath as 'node',
    ...(config.pathToClaudeCodeExecutable
      ? { pathToClaudeCodeExecutable: config.pathToClaudeCodeExecutable }
      : {}),
    ...(config.betas ? { betas: config.betas as Options['betas'] } : {}),
    ...(config.thinking ? { thinking: config.thinking as Options["thinking"] } : {}),
    ...(config.effort ? { effort: config.effort as Options["effort"] } : {}),
    ...(config.fallbackModel ? { fallbackModel: config.fallbackModel } : {}),
    ...(config.outputFormat ? { outputFormat: config.outputFormat as Options["outputFormat"] } : {}),
    ...(typeof config.promptSuggestions === "boolean"
      ? { promptSuggestions: config.promptSuggestions }
      : {}),
    ...(stderr ? { stderr } : {}),
  };
}
