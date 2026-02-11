import type { SidecarConfig } from "./config.js";

/**
 * Build the options object to pass to the SDK query() function.
 *
 * Agent / model resolution (settingSources: ['project'] always passed for skill discovery):
 *  - agentName only  → agent (front-matter model used)
 *  - model only      → model
 *  - both            → agent + model (model overrides front-matter)
 */
export function buildQueryOptions(config: SidecarConfig, abortController: AbortController) {
  // --- agent / model resolution ---
  const agentField = config.agentName ? { agent: config.agentName } : {};

  // When model is set, always pass it — whether it's the sole identifier
  // (model-only) or overriding the agent's front-matter model (both).
  const modelField = config.model ? { model: config.model } : {};

  return {
    ...agentField,
    ...modelField,
    // Always pass settingSources so the SDK discovers skills from
    // {cwd}/.claude/skills/{name}/SKILL.md regardless of agent mode.
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
    executable: process.execPath,
    ...(config.pathToClaudeCodeExecutable
      ? { pathToClaudeCodeExecutable: config.pathToClaudeCodeExecutable }
      : {}),
    ...(config.sessionId ? { resume: config.sessionId } : {}),
    ...(config.betas ? { betas: config.betas } : {}),
  };
}
