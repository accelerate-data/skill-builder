import * as path from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { SidecarConfig } from "./config.js";

/**
 * Infer the plugin name from a namespaced agent name.
 * "skill-content-researcher:research-agent" → "skill-content-researcher"
 * Returns null if agentName is absent or not namespaced.
 */
function inferPluginFromAgentName(agentName: string | undefined): string | null {
  if (!agentName) return null;
  const idx = agentName.indexOf(":");
  if (idx <= 0) return null;
  return agentName.slice(0, idx);
}

/**
 * Build the options object to pass to the SDK query() function.
 *
 * Agent / model resolution (settingSources: ['project'] always passed for project settings):
 *  - agentName only  → agent (front-matter model used)
 *  - model only      → model
 *  - both            → agent only (front-matter model authoritative)
 */
export function buildQueryOptions(
  config: SidecarConfig,
  abortController: AbortController,
  stderr?: (data: string) => void,
) {
  // Resolve plugin directories from the workspace's .claude/plugins/ folder so
  // the SDK can discover plugin agents (e.g. skill-content-researcher:research-agent).
  // Also infer the plugin name from a namespaced agentName so callers that only
  // set agentName (and not requiredPlugins) still get the plugin loaded.
  const explicitPlugins = (config.requiredPlugins ?? []).filter(
    (p) => p && p.trim().length > 0,
  );
  const inferredPlugin = inferPluginFromAgentName(config.agentName);
  const allPluginNames = [...new Set([...explicitPlugins, ...(inferredPlugin ? [inferredPlugin] : [])])];
  const pluginEntries = allPluginNames.map((name) => ({
    type: "local" as const,
    path: path.resolve(config.cwd, ".claude", "plugins", name),
  }));
  const pluginsField = pluginEntries.length > 0 ? { plugins: pluginEntries } : {};
  // --- agent / model resolution ---
  const hasAgent = typeof config.agentName === "string" && config.agentName.length > 0;
  const agentField = hasAgent ? { agent: config.agentName } : {};
  const modelField = !hasAgent && config.model ? { model: config.model } : {};

  // Pass the API key through the SDK's env option instead of mutating
  // process.env, which avoids races on concurrent requests.
  const envField = config.apiKey
    ? { env: { ...process.env, ANTHROPIC_API_KEY: config.apiKey } }
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
