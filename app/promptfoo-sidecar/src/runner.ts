import { evaluate } from "promptfoo";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import {
  parseSidecarRequest,
  serializeSidecarEvent,
  type EvalAssertion,
  type EvalCandidate,
  type EvalCase,
  type EvalExecution,
  type RunEvalRequest,
  type SidecarEvent,
} from "./protocol.js";
import { normalizePromptfooResults } from "./result-normalizer.js";

type PromptfooAssertion = {
  type: "equals" | "contains" | "javascript";
  value: string;
};

type PromptfooProvider = {
  id: () => string;
  label?: string;
  callApi: (
    prompt: string,
    context?: { vars?: Record<string, unknown> },
  ) => Promise<{ output: unknown }>;
};

export async function runJsonlSidecar(
  input: NodeJS.ReadableStream = stdin,
  output: NodeJS.WritableStream = stdout,
): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }

    const request = parseRequest(line, output);
    if (!request) {
      continue;
    }

    try {
      await handleRunEvalRequest(request, output);
    } catch (error) {
      writeEvent(output, {
        id: request.id,
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function parseRequest(
  line: string,
  output: NodeJS.WritableStream,
): RunEvalRequest | null {
  try {
    return parseSidecarRequest(line);
  } catch (error) {
    writeEvent(output, {
      id: "unknown",
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function handleRunEvalRequest(
  request: RunEvalRequest,
  output: NodeJS.WritableStream,
): Promise<void> {
  const executionMap = buildExecutionMap(request.executions);
  const providers = buildProviders(request.candidates, executionMap);
  const tests = buildTests(request.cases);
  const total = request.executions.length;

  for (let index = 0; index < request.executions.length; index += 1) {
    const execution = request.executions[index];
    writeEvent(output, {
      id: request.id,
      type: "progress",
      completed: index + 1,
      total,
      caseId: execution.caseId,
      candidateId: execution.candidateId,
    });
  }

  const result = await evaluate({
    prompts: ["{{prompt}}"],
    providers,
    tests,
    evaluateOptions: {
      maxConcurrency: 1,
    },
  });

  writeEvent(output, {
    id: request.id,
    type: "result",
    result: normalizePromptfooResults(request.mode, result.results ?? []),
  });
}

function buildExecutionMap(executions: EvalExecution[]): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const execution of executions) {
    map.set(executionKey(execution.caseId, execution.candidateId), execution.output);
  }
  return map;
}

function buildProviders(
  candidates: EvalCandidate[],
  executionMap: Map<string, unknown>,
): PromptfooProvider[] {
  return candidates.map((candidate) => ({
    id: () => candidate.id,
    label: candidate.label,
    callApi: async (_prompt, context) => {
      const caseId = String(context?.vars?.caseId ?? "");
      const output = executionMap.get(executionKey(caseId, candidate.id));
      if (output === undefined) {
        throw new Error(
          `Missing execution output for case=${caseId} candidate=${candidate.id}`,
        );
      }
      return { output };
    },
  }));
}

function buildTests(cases: EvalCase[]) {
  return cases.map((testCase) => ({
    vars: {
      caseId: testCase.id,
      prompt: testCase.prompt,
    },
    assert: buildAssertions(testCase),
  }));
}

function buildAssertions(testCase: EvalCase): PromptfooAssertion[] {
  const assertions = testCase.assertions.map(toPromptfooAssertion);

  if (testCase.expected) {
    assertions.push({
      type: "contains",
      value: testCase.expected,
    });
  }

  if (typeof testCase.shouldTrigger === "boolean") {
    assertions.push({
      type: "javascript",
      value: `output?.invokedTargetSkill === ${String(testCase.shouldTrigger)}`,
    });
  }

  return assertions;
}

function toPromptfooAssertion(assertion: EvalAssertion): PromptfooAssertion {
  const value =
    typeof assertion.value === "string"
      ? assertion.value
      : JSON.stringify(assertion.value);

  return {
    type: assertion.type,
    value,
  };
}

function executionKey(caseId: string, candidateId: string): string {
  return `${candidateId}::${caseId}`;
}

function writeEvent(output: NodeJS.WritableStream, event: SidecarEvent): void {
  output.write(serializeSidecarEvent(event));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runJsonlSidecar();
}
