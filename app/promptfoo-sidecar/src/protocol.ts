export type EvalMode = "performance" | "trigger";

export type EvalAssertion = {
  type: "equals" | "contains" | "javascript";
  value: string;
};

export type EvalCase = {
  id: string;
  prompt: string;
  expected?: string;
  shouldTrigger?: boolean;
  assertions: EvalAssertion[];
};

export type EvalCandidate = {
  id: string;
  label: string;
  description?: string;
};

export type EvalDescriptionCandidate = EvalCandidate & {
  rationale?: string;
  rank?: number | null;
};

export type EvalExecution = {
  caseId: string;
  candidateId: string;
  output: unknown;
};

export type EvalHistoryConfig = {
  configDir: string;
  persist?: boolean;
};

export type EvalHistoryMetadata = {
  source: "eval_workbench";
  pluginSlug: string;
  skillName: string;
  scenarioName: string;
  mode: EvalMode;
};

export type RunEvalRequest = {
  id: string;
  type: "run_eval";
  mode: EvalMode;
  skillName: string;
  pluginSlug: string;
  scenarioName: string;
  promptfooConfigDir: string;
  candidates: EvalCandidate[];
  cases: EvalCase[];
  executions: EvalExecution[];
};

export type ListHistoryRequest = {
  id: string;
  type: "list_history";
  promptfooConfigDir: string;
  pluginSlug: string;
  skillName: string;
  scenarioName?: string;
  mode: EvalMode;
  limit: number;
};

export type ReadHistoryRequest = {
  id: string;
  type: "read_history";
  promptfooConfigDir: string;
  runId: string;
};

export type SidecarRequest =
  | RunEvalRequest
  | ListHistoryRequest
  | ReadHistoryRequest;

export type SidecarEvent =
  | {
      id: string;
      type: "progress";
      completed: number;
      total: number;
      caseId?: string;
      candidateId?: string;
    }
  | { id: string; type: "result"; result: EvalRunResult }
  | { id: string; type: "result"; runs: PersistedEvalRun[] }
  | { id: string; type: "result"; run: PersistedEvalRun | null }
  | { id: string; type: "error"; message: string };

export type EvalCaseResult = {
  caseId: string;
  candidateId: string;
  passed: boolean;
  score: number;
  output: unknown;
  reason?: string;
};

export type PersistedScenarioSnapshotCase = {
  id: string;
  prompt: string;
  expected?: string;
  shouldTrigger?: boolean;
  assertions: EvalAssertion[];
  sortOrder: number;
};

export type PersistedScenarioSnapshot = {
  pluginSlug: string;
  skillName: string;
  scenarioName: string;
  mode: EvalMode;
  cases: PersistedScenarioSnapshotCase[];
};

export type EvalRunResult = {
  mode: EvalMode;
  total: number;
  passed: number;
  failed: number;
  results: EvalCaseResult[];
  history?: {
    persisted: boolean;
    configDir?: string;
    evalId?: string;
    metadata?: EvalHistoryMetadata;
  };
};

export type EvalHistoryListItem = {
  evalId: string;
  createdAt: number;
  description?: string;
  total: number;
  passed: number;
  failed: number;
  metadata: EvalHistoryMetadata;
};

export type EvalHistoryListResult = {
  items: EvalHistoryListItem[];
  limit: number;
  offset: number;
};

export type EvalHistoryCaseDetail = {
  caseId?: string;
  candidateId?: string;
  prompt?: string;
  testIdx: number;
  promptIdx: number;
  success: boolean;
  score: number;
  response?: unknown;
  error?: string;
  latencyMs?: number;
  cost?: number;
  failureReason?: string | number;
  gradingResult?: unknown;
  metadata?: Record<string, unknown>;
  providerId?: string;
  providerLabel?: string;
};

export type EvalHistoryEntry = EvalHistoryListItem & {
  config?: Record<string, unknown>;
  cases: EvalHistoryCaseDetail[];
};

export type EvalHistoryReadResult = {
  entry: EvalHistoryEntry;
};

export type PersistedEvalRun = {
  id: string;
  promptfooEvalId: string;
  pluginSlug: string;
  skillName: string;
  scenarioName: string;
  mode: EvalMode;
  status: "completed";
  summary: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
  };
  scenarioSnapshot?: PersistedScenarioSnapshot;
  createdAt: string;
  completedAt: string | null;
  results: EvalCaseResult[];
};

const EVAL_MODES = new Set<EvalMode>(["performance", "trigger"]);
const ASSERTION_TYPES = new Set<EvalAssertion["type"]>([
  "equals",
  "contains",
  "javascript",
]);

export function parseSidecarRequest(line: string): SidecarRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new Error(`Invalid JSONL request: ${formatError(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("Sidecar request must be a JSON object");
  }

  if (parsed.type === "run_eval") {
    return validateRunEvalRequest(parsed);
  }
  if (parsed.type === "list_history") {
    return validateListHistoryRequest(parsed);
  }
  if (parsed.type === "read_history") {
    return validateReadHistoryRequest(parsed);
  }

  const requestType = typeof parsed.type === "string" ? parsed.type : "unknown";
  throw new Error(`Unsupported sidecar request type: ${requestType}`);
}

export function serializeSidecarEvent(event: SidecarEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function serializeSidecarRequest(request: SidecarRequest): string {
  return `${JSON.stringify(request)}\n`;
}

function validateRunEvalRequest(
  value: Record<string, unknown>,
): RunEvalRequest {
  const id = requireString(value.id, "id");
  const mode = requireEvalMode(value.mode);
  const skillName = requireString(value.skillName, "skillName");
  const pluginSlug = requireString(value.pluginSlug, "pluginSlug");
  const scenarioName = requireString(value.scenarioName, "scenarioName");
  const promptfooConfigDir = requireString(
    value.promptfooConfigDir,
    "promptfooConfigDir",
  );
  const candidates = requireArray(value.candidates, "candidates").map(
    validateCandidate,
  );
  const cases = requireArray(value.cases, "cases").map(validateCase);
  const executions = requireArray(value.executions, "executions").map(
    validateExecution,
  );
  const history =
    value.history === undefined
      ? undefined
      : validateHistoryConfig(value.history, "history");
  const descriptionCandidates =
    value.descriptionCandidates === undefined
      ? undefined
      : requireArray(
          value.descriptionCandidates,
          "descriptionCandidates",
        ).map((candidate, index) =>
          validateDescriptionCandidate(candidate, index),
        );

  return {
    id,
    type: "run_eval",
    mode,
    skillName,
    pluginSlug,
    scenarioName,
    promptfooConfigDir,
    candidates,
    cases,
    executions,
  };
}

function validateListHistoryRequest(
  value: Record<string, unknown>,
): ListHistoryRequest {
  const request: ListHistoryRequest = {
    id: requireString(value.id, "id"),
    type: "list_history",
    promptfooConfigDir: requireString(
      value.promptfooConfigDir,
      "promptfooConfigDir",
    ),
    pluginSlug: requireString(value.pluginSlug, "pluginSlug"),
    skillName: requireString(value.skillName, "skillName"),
    mode: requireEvalMode(value.mode),
    limit: requirePositiveInteger(value.limit, "limit"),
  };
  if (value.scenarioName !== undefined) {
    request.scenarioName = requireString(value.scenarioName, "scenarioName");
  }
  return request;
}

function validateReadHistoryRequest(
  value: Record<string, unknown>,
): ReadHistoryRequest {
  return {
    id: requireString(value.id, "id"),
    type: "read_history",
    promptfooConfigDir: requireString(
      value.promptfooConfigDir,
      "promptfooConfigDir",
    ),
    runId: requireString(value.runId, "runId"),
  };
}

function validateCandidate(value: unknown, index: number): EvalCandidate {
  if (!isRecord(value)) {
    throw new Error(`candidates[${index}] must be an object`);
  }

  const candidate: EvalCandidate = {
    id: requireString(value.id, `candidates[${index}].id`),
    label: requireString(value.label, `candidates[${index}].label`),
  };

  if (value.description !== undefined) {
    candidate.description = requireString(
      value.description,
      `candidates[${index}].description`,
    );
  }

  return candidate;
}

function validateDescriptionCandidate(
  value: unknown,
  index: number,
): EvalDescriptionCandidate {
  const candidate = validateCandidate(value, index);
  if (!isRecord(value)) {
    throw new Error(`descriptionCandidates[${index}] must be an object`);
  }

  const descriptionCandidate: EvalDescriptionCandidate = { ...candidate };
  if (value.rationale !== undefined) {
    descriptionCandidate.rationale = requireString(
      value.rationale,
      `descriptionCandidates[${index}].rationale`,
    );
  }
  if (value.rank !== undefined) {
    descriptionCandidate.rank = requireNullableInteger(
      value.rank,
      `descriptionCandidates[${index}].rank`,
    );
  }
  return descriptionCandidate;
}

function validateCase(value: unknown, index: number): EvalCase {
  if (!isRecord(value)) {
    throw new Error(`cases[${index}] must be an object`);
  }

  const testCase: EvalCase = {
    id: requireString(value.id, `cases[${index}].id`),
    prompt: requireString(value.prompt, `cases[${index}].prompt`),
    assertions: requireArray(
      value.assertions,
      `cases[${index}].assertions`,
    ).map((assertion, assertionIndex) =>
      validateAssertion(assertion, index, assertionIndex),
    ),
  };

  if (value.expected !== undefined) {
    testCase.expected = requireString(
      value.expected,
      `cases[${index}].expected`,
    );
  }
  if (value.shouldTrigger !== undefined) {
    testCase.shouldTrigger = requireBoolean(
      value.shouldTrigger,
      `cases[${index}].shouldTrigger`,
    );
  }

  return testCase;
}

function validateExecution(value: unknown, index: number): EvalExecution {
  if (!isRecord(value)) {
    throw new Error(`executions[${index}] must be an object`);
  }

  return {
    caseId: requireString(value.caseId, `executions[${index}].caseId`),
    candidateId: requireString(
      value.candidateId,
      `executions[${index}].candidateId`,
    ),
    output: value.output,
  };
}

function validateAssertion(
  value: unknown,
  caseIndex: number,
  assertionIndex: number,
): EvalAssertion {
  const field = `cases[${caseIndex}].assertions[${assertionIndex}]`;
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object`);
  }

  if (
    typeof value.type !== "string" ||
    !ASSERTION_TYPES.has(value.type as EvalAssertion["type"])
  ) {
    throw new Error(`${field}.type must be equals, contains, or javascript`);
  }

  return {
    type: value.type as EvalAssertion["type"],
    value: requireString(value.value, `${field}.value`),
  };
}

function validateHistoryConfig(
  value: unknown,
  field: string,
): EvalHistoryConfig {
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object`);
  }

  const history: EvalHistoryConfig = {
    configDir: requireString(value.configDir, `${field}.configDir`),
  };

  if (value.persist !== undefined) {
    history.persist = requireBoolean(value.persist, `${field}.persist`);
  }

  return history;
}

function validateHistoryFilter(value: unknown): ListEvalHistoryRequest["filter"] {
  if (!isRecord(value)) {
    throw new Error("filter must be an object");
  }

  const filter: ListEvalHistoryRequest["filter"] = {
    configDir: requireString(value.configDir, "filter.configDir"),
    pluginSlug: requireString(value.pluginSlug, "filter.pluginSlug"),
    skillName: requireString(value.skillName, "filter.skillName"),
  };

  if (value.scenarioName !== undefined) {
    filter.scenarioName = requireString(
      value.scenarioName,
      "filter.scenarioName",
    );
  }
  if (value.mode !== undefined) {
    filter.mode = requireEvalMode(value.mode);
  }
  if (value.limit !== undefined) {
    filter.limit = requirePositiveInteger(value.limit, "filter.limit");
  }
  if (value.offset !== undefined) {
    filter.offset = requireNonNegativeInteger(value.offset, "filter.offset");
  }

  return filter;
}

function requireEvalMode(value: unknown): EvalMode {
  if (typeof value === "string" && EVAL_MODES.has(value as EvalMode)) {
    return value as EvalMode;
  }

  throw new Error("mode must be performance or trigger");
}

function requireString(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  throw new Error(`${field} must be a non-empty string`);
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  throw new Error(`${field} must be a boolean`);
}

function requireArray(value: unknown, field: string): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  throw new Error(`${field} must be an array`);
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  throw new Error(`${field} must be a positive integer`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
