export interface SidecarConfig {
  prompt: string;
  model?: string;
  agentName?: string;
  apiKey: string;
  cwd: string;
  requiredPlugins?: string[];
  allowedTools?: string[];
  maxTurns?: number;
  permissionMode?: string;
  betas?: string[];
  thinking?: { type: "disabled" | "adaptive" | "enabled"; budgetTokens?: number };
  effort?: "low" | "medium" | "high" | "max";
  fallbackModel?: string;
  outputFormat?: {
    type: "json_schema";
    schema: Record<string, unknown>;
  };
  promptSuggestions?: boolean;
  pathToClaudeCodeExecutable?: string;
  /** Skill name this run is associated with. Used by mock agent for template discrimination. */
  skillName?: string;
  /** Step ID for persistence (-1=unknown, -10=refine, -11=test, 0-3=workflow steps). */
  stepId?: number;
  /** Workflow session ID for persistence. */
  workflowSessionId?: string;
  /** Synthetic usage session ID (for non-workflow runs). */
  usageSessionId?: string;
  /** Run source for persistence attribution. */
  runSource?: "workflow" | "refine" | "test";
}

/**
 * Runtime-validate an unknown value into a SidecarConfig.
 * Replaces unsafe `as SidecarConfig` casts in persistent-mode.
 */
export function parseSidecarConfig(raw: unknown): SidecarConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Invalid SidecarConfig: expected object");
  }
  const c = raw as Record<string, unknown>;
  if (typeof c.prompt !== "string") throw new Error("Invalid SidecarConfig: missing prompt");
  if (typeof c.apiKey !== "string" || c.apiKey.length === 0) throw new Error("Invalid SidecarConfig: missing apiKey");
  if (typeof c.cwd !== "string") throw new Error("Invalid SidecarConfig: missing cwd");

  if (c.requiredPlugins !== undefined) {
    if (!Array.isArray(c.requiredPlugins) || c.requiredPlugins.some((p) => typeof p !== "string")) {
      throw new Error("Invalid SidecarConfig: requiredPlugins must be string[]");
    }
  }

  return raw as SidecarConfig;
}
