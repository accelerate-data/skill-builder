import type { SidecarConfig } from "./config.js";

/**
 * Build the options object to pass to the SDK query() function.
 *
 * Agent / model resolution (settingSources: ['project'] always passed for project settings):
 *  - agentName only  → agent (front-matter model used)
 *  - model only      → model
 *  - both            → agent + model (model overrides front-matter)
 */
export function buildQueryOptions(
  config: SidecarConfig,
  abortController: AbortController,
  stderr?: (data: string) => void,
) {
  // --- agent / model resolution ---
  const agentField = config.agentName ? { agent: config.agentName } : {};

  // When model is set, always pass it — whether it's the sole identifier
  // (model-only) or overriding the agent's front-matter model (both).
  const modelField = config.model ? { model: config.model } : {};

  return {
    ...agentField,
    ...modelField,
    // Load project settings (skill discovery, CLAUDE.md) and user settings
    // (MCP servers from ~/.claude/settings.json).
    settingSources: ['project' as const, 'user' as const],
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
    executable: process.execPath,
    ...(config.pathToClaudeCodeExecutable
      ? { pathToClaudeCodeExecutable: config.pathToClaudeCodeExecutable }
      : {}),
    ...(config.sessionId ? { resume: config.sessionId } : {}),
    ...(config.betas ? { betas: config.betas } : {}),
    ...(config.maxThinkingTokens ? { maxThinkingTokens: config.maxThinkingTokens } : {}),
    ...(stderr ? { stderr } : {}),
  };
}
