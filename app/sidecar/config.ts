export interface OpenHandsLlmConfig {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutSeconds?: number;
  numRetries?: number;
  reasoningEffort?: "auto" | "low" | "medium" | "high";
  extraHeaders?: Record<string, string>;
  inputCostPerToken?: number;
  outputCostPerToken?: number;
  usageId?: string;
}

export interface SidecarConfig {
  mode?: "throwaway" | "streaming";
  prompt: string;
  systemPrompt?: string;
  taskKind?: string;
  userMessageSuffix?: string;
  model?: string;
  modelBaseUrl?: string;
  llm?: OpenHandsLlmConfig;
  agentName?: string;
  apiKey: string;
  /** Workspace root directory ({data_dir}/workspace). */
  workspaceRootDir: string;
  /** Skill-scoped workspace directory ({workspace}/{plugin_slug}/{skill_name}). */
  workspaceSkillDir: string;
  requiredPlugins?: string[];
  allowedTools?: string[];
  settingSources?: ('user' | 'project')[];
  maxTurns?: number;
  permissionMode?: string;
  betas?: string[];
  thinking?: { type: "disabled" | "adaptive" | "enabled"; budgetTokens?: number };
  outputFormat?: {
    type: "json_schema";
    schema: Record<string, unknown>;
  };
  promptSuggestions?: boolean;
  /** OpenHands-native SDK persistence directory. */
  persistenceDir?: string;
  /** Skill name this run is associated with. Used by mock agent for template discrimination. */
  skillName?: string;
  /** Step ID for persistence (-1=unknown, -10=refine, -11=test, 0-3=workflow steps). */
  stepId?: number;
  /** Workflow session ID for persistence. */
  workflowSessionId?: string;
  /** Synthetic usage session ID (for non-workflow runs). */
  usageSessionId?: string;
  /** Run source for persistence attribution. */
  runSource?: "workflow" | "refine" | "test" | "gate-eval" | "scenario-suggest";
  /** Plugin slug for the skill (from plugin-paths.json: {root}/{plugin_slug}/{skill_name}).
   * Threaded through to run_result so persistence handlers can resolve the correct skill dir. */
  pluginSlug: string;
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

function assertOptStringInAs(
  c: Record<string, unknown>,
  field: string,
  label: string,
  allowed: readonly string[],
): void {
  if (c[field] !== undefined) {
    if (typeof c[field] !== "string" || !allowed.includes(c[field] as string)) {
      throw new Error(`Invalid SidecarConfig: ${label} must be one of ${allowed.join(", ")}`);
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

function assertOptPositiveIntAs(c: Record<string, unknown>, field: string, label: string): void {
  if (c[field] !== undefined) {
    if (typeof c[field] !== "number" || !Number.isInteger(c[field]) || (c[field] as number) <= 0) {
      throw new Error(`Invalid SidecarConfig: ${label} must be a positive integer`);
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

function assertOptStringRecord(c: Record<string, unknown>, field: string): void {
  if (c[field] !== undefined) {
    if (
      typeof c[field] !== "object" ||
      c[field] === null ||
      Array.isArray(c[field]) ||
      Object.values(c[field] as Record<string, unknown>).some(
        (v) => typeof v !== "string",
      )
    ) {
      throw new Error(`Invalid SidecarConfig: ${field} must be Record<string, string>`);
    }
  }
}

function assertOpenHandsLlmConfig(raw: unknown): void {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Invalid SidecarConfig: llm must be an object");
  }
  const llm = raw as Record<string, unknown>;
  if (typeof llm.model !== "string" || llm.model.length === 0) {
    throw new Error("Invalid SidecarConfig: llm.model must be a string");
  }

  assertOptString(llm, "apiKey");
  assertOptString(llm, "baseUrl");
  assertOptString(llm, "apiVersion");
  assertOptString(llm, "usageId");
  assertOptNumber(llm, "temperature");
  assertOptPositiveIntAs(llm, "maxOutputTokens", "llm.maxOutputTokens");
  assertOptPositiveIntAs(llm, "timeoutSeconds", "llm.timeoutSeconds");
  assertOptPositiveIntAs(llm, "numRetries", "llm.numRetries");
  assertOptStringInAs(llm, "reasoningEffort", "llm.reasoningEffort", ["auto", "low", "medium", "high"]);
  assertOptStringRecord(llm, "extraHeaders");
  assertOptNumber(llm, "inputCostPerToken");
  assertOptNumber(llm, "outputCostPerToken");
}

/**
 * Runtime-validate an unknown value into a SidecarConfig.
 * Replaces unsafe `as SidecarConfig` casts.
 */
export function parseSidecarConfig(raw: unknown): SidecarConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Invalid SidecarConfig: expected object");
  }
  const c = raw as Record<string, unknown>;

  // Required fields
  if (typeof c.prompt !== "string") throw new Error("Invalid SidecarConfig: missing prompt");
  if (typeof c.apiKey !== "string" || c.apiKey.length === 0) throw new Error("Invalid SidecarConfig: missing apiKey");
  if (typeof c.workspaceRootDir !== "string") throw new Error("Invalid SidecarConfig: missing workspaceRootDir");
  if (typeof c.workspaceSkillDir !== "string") throw new Error("Invalid SidecarConfig: missing workspaceSkillDir");

  // Optional string fields
  assertOptString(c, "model");
  assertOptString(c, "modelBaseUrl");
  assertOptString(c, "taskKind");
  assertOptString(c, "userMessageSuffix");
  assertOptString(c, "agentName");
  assertOptString(c, "skillName");
  assertOptString(c, "workflowSessionId");
  assertOptString(c, "usageSessionId");
  assertOptString(c, "persistenceDir");

  // Optional enum fields
  assertOptStringIn(c, "mode", ["throwaway", "streaming"]);
  assertOptStringIn(c, "permissionMode", ["default", "acceptEdits", "bypassPermissions", "plan"]);
  assertOptStringIn(c, "runSource", ["workflow", "refine", "test", "gate-eval", "scenario-suggest"]);
  if (c.llm !== undefined) {
    assertOpenHandsLlmConfig(c.llm);
  }

  // Optional numeric fields
  assertOptPositiveInt(c, "maxTurns");
  assertOptNumber(c, "stepId");

  // Optional boolean fields
  assertOptBoolean(c, "promptSuggestions");

  // Optional array fields
  assertOptStringArray(c, "requiredPlugins");
  assertOptStringArray(c, "allowedTools");
  assertOptStringArray(c, "settingSources");
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

/**
 * Return a shallow copy of the config with sensitive fields redacted.
 * Use this before logging or serializing config objects to prevent
 * accidental API key exposure in stderr/transcripts.
 */
export function redactConfig(config: SidecarConfig): Record<string, unknown> {
  const redactedLlm = config.llm
    ? {
        ...config.llm,
        apiKey: config.llm.apiKey ? "[REDACTED]" : config.llm.apiKey,
        extraHeaders: config.llm.extraHeaders
          ? Object.fromEntries(
              Object.keys(config.llm.extraHeaders).map((key) => [
                key,
                "[REDACTED]",
              ]),
            )
          : config.llm.extraHeaders,
      }
    : undefined;

  return {
    ...config,
    apiKey: "[REDACTED]",
    ...(redactedLlm ? { llm: redactedLlm } : {}),
  };
}
