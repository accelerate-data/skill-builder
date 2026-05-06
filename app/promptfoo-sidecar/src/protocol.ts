export type EvalMode = "performance" | "trigger";

export type EvalCase = {
  id: string;
  prompt: string;
  expected?: string;
  shouldTrigger?: boolean;
  expectations: string[];
};

export type EvalCandidate = {
  id: string;
  label: string;
  description?: string;
};

export type EvalExecution = {
  caseId: string;
  candidateId: string;
  output: unknown;
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
  expectations: string[];
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

function validateCase(value: unknown, index: number): EvalCase {
  if (!isRecord(value)) {
    throw new Error(`cases[${index}] must be an object`);
  }

  const testCase: EvalCase = {
    id: requireString(value.id, `cases[${index}].id`),
    prompt: requireString(value.prompt, `cases[${index}].prompt`),
    expectations: requireArray(
      value.expectations,
      `cases[${index}].expectations`,
    ).map((expectation, expectationIndex) =>
      requireString(
        expectation,
        `cases[${index}].expectations[${expectationIndex}]`,
      ),
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
