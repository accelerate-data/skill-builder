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

export type RunEvalRequest = {
  id: string;
  type: "run_eval";
  mode: EvalMode;
  skillName: string;
  pluginSlug: string;
  candidates: EvalCandidate[];
  cases: EvalCase[];
};

export type ProviderCallRequest = {
  id: string;
  type: "provider_call";
  mode: EvalMode;
  skillName: string;
  pluginSlug: string;
  candidate?: EvalCandidate;
  testCase: EvalCase;
};

export type SidecarRequest = RunEvalRequest;

export type SidecarEvent =
  | {
      id: string;
      type: "progress";
      completed: number;
      total: number;
      caseId?: string;
      candidateId?: string;
    }
  | { id: string; type: "provider_call"; request: ProviderCallRequest }
  | { id: string; type: "result"; result: EvalRunResult }
  | { id: string; type: "error"; message: string };

export type ProviderCallResponse = {
  id: string;
  type: "provider_result";
  output: unknown;
};

export type EvalCaseResult = {
  caseId: string;
  candidateId: string;
  passed: boolean;
  score: number;
  output: unknown;
  reason?: string;
};

export type EvalRunResult = {
  mode: EvalMode;
  total: number;
  passed: number;
  failed: number;
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

  if (parsed.type !== "run_eval") {
    const requestType =
      typeof parsed.type === "string" ? parsed.type : "unknown";
    throw new Error(`Unsupported sidecar request type: ${requestType}`);
  }

  return validateRunEvalRequest(parsed);
}

export function serializeSidecarEvent(event: SidecarEvent): string {
  return `${JSON.stringify(event)}\n`;
}

function validateRunEvalRequest(
  value: Record<string, unknown>,
): RunEvalRequest {
  const id = requireString(value.id, "id");
  const mode = requireEvalMode(value.mode);
  const skillName = requireString(value.skillName, "skillName");
  const pluginSlug = requireString(value.pluginSlug, "pluginSlug");
  const candidates = requireArray(value.candidates, "candidates").map(
    validateCandidate,
  );
  const cases = requireArray(value.cases, "cases").map(validateCase);

  return {
    id,
    type: "run_eval",
    mode,
    skillName,
    pluginSlug,
    candidates,
    cases,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
