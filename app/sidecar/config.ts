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

// --- Validation helpers ---------------------------------------------------

function assertOptString(c: Record<string, unknown>, field: string): void {
  if (c[field] !== undefined && typeof c[field] !== "string") {
    throw new Error(`Invalid SidecarConfig: ${field} must be a string`);
  }
}

function assertOptStringIn(c: Record<string, unknown>, field: string, allowed: readonly string[]): void {
  if (c[field] !== undefined) {
    if (typeof c[field] !== "string" || !allowed.includes(c[field] as string)) {
      throw new Error(`Invalid SidecarConfig: ${field} must be one of ${allowed.join(", ")}`);
    }
  }
}

function assertOptPositiveInt(c: Record<string, unknown>, field: string): void {
  if (c[field] !== undefined) {
    if (typeof c[field] !== "number" || !Number.isInteger(c[field]) || (c[field] as number) <= 0) {
      throw new Error(`Invalid SidecarConfig: ${field} must be a positive integer`);
    }
  }
}

function assertOptNumber(c: Record<string, unknown>, field: string): void {
  if (c[field] !== undefined && typeof c[field] !== "number") {
    throw new Error(`Invalid SidecarConfig: ${field} must be a number`);
  }
}

function assertOptBoolean(c: Record<string, unknown>, field: string): void {
  if (c[field] !== undefined && typeof c[field] !== "boolean") {
    throw new Error(`Invalid SidecarConfig: ${field} must be a boolean`);
  }
}

function assertOptStringArray(c: Record<string, unknown>, field: string): void {
  if (c[field] !== undefined) {
    if (!Array.isArray(c[field]) || (c[field] as unknown[]).some((v) => typeof v !== "string")) {
      throw new Error(`Invalid SidecarConfig: ${field} must be string[]`);
    }
  }
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

  // Required fields
  if (typeof c.prompt !== "string") throw new Error("Invalid SidecarConfig: missing prompt");
  if (typeof c.apiKey !== "string" || c.apiKey.length === 0) throw new Error("Invalid SidecarConfig: missing apiKey");
  if (typeof c.cwd !== "string") throw new Error("Invalid SidecarConfig: missing cwd");

  // Optional string fields
  assertOptString(c, "model");
  assertOptString(c, "agentName");
  assertOptString(c, "fallbackModel");
  assertOptString(c, "skillName");
  assertOptString(c, "workflowSessionId");
  assertOptString(c, "usageSessionId");
  assertOptString(c, "pathToClaudeCodeExecutable");

  // Optional enum fields
  assertOptStringIn(c, "permissionMode", ["default", "acceptEdits", "bypassPermissions", "plan"]);
  assertOptStringIn(c, "effort", ["low", "medium", "high", "max"]);
  assertOptStringIn(c, "runSource", ["workflow", "refine", "test"]);

  // Optional numeric fields
  assertOptPositiveInt(c, "maxTurns");
  assertOptNumber(c, "stepId");

  // Optional boolean fields
  assertOptBoolean(c, "promptSuggestions");

  // Optional array fields
  assertOptStringArray(c, "requiredPlugins");
  assertOptStringArray(c, "allowedTools");
  assertOptStringArray(c, "betas");

  // Optional thinking object
  if (c.thinking !== undefined) {
    if (typeof c.thinking !== "object" || c.thinking === null) {
      throw new Error("Invalid SidecarConfig: thinking must be an object");
    }
    const t = c.thinking as Record<string, unknown>;
    if (!["disabled", "adaptive", "enabled"].includes(t.type as string)) {
      throw new Error("Invalid SidecarConfig: thinking.type must be disabled, adaptive, or enabled");
    }
    if (t.budgetTokens !== undefined && typeof t.budgetTokens !== "number") {
      throw new Error("Invalid SidecarConfig: thinking.budgetTokens must be a number");
    }
  }

  // Optional outputFormat object
  if (c.outputFormat !== undefined) {
    if (typeof c.outputFormat !== "object" || c.outputFormat === null) {
      throw new Error("Invalid SidecarConfig: outputFormat must be an object");
    }
    const o = c.outputFormat as Record<string, unknown>;
    if (o.type !== "json_schema") {
      throw new Error("Invalid SidecarConfig: outputFormat.type must be json_schema");
    }
    if (typeof o.schema !== "object" || o.schema === null) {
      throw new Error("Invalid SidecarConfig: outputFormat.schema must be an object");
    }
  }

  return raw as SidecarConfig;
}
