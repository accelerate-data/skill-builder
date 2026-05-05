import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import {
  buildEvalHistoryMetadata,
  buildPromptfooHistoryTags,
  listEvalHistory,
  readEvalHistory,
} from "./history-store.js";
import {
  parseSidecarRequest,
  serializeSidecarEvent,
  type EvalAssertion,
  type EvalCandidate,
  type EvalCase,
  type EvalExecution,
  type RunEvalRequest,
  type SidecarRequest,
  type SidecarEvent,
} from "./protocol.js";
import {
  normalizePromptfooResults,
  type PromptfooLikeResult,
} from "./result-normalizer.js";

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

type EvaluateFn = typeof import("promptfoo")["evaluate"];

let activePromptfooConfigDir: string | null = null;
let promptfooEvaluate: EvaluateFn | null = null;

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
      await handleRequest(request, output);
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
): SidecarRequest | null {
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

async function handleRequest(
  request: SidecarRequest,
  output: NodeJS.WritableStream,
): Promise<void> {
  switch (request.type) {
    case "run_eval":
      await handleRunEvalRequest(request, output);
      return;
    case "list_eval_history":
      writeEvent(output, {
        id: request.id,
        type: "history_list_result",
        result: listEvalHistory(request.filter),
      });
      return;
    case "read_eval_history":
      writeEvent(output, {
        id: request.id,
        type: "history_read_result",
        result: { entry: readEvalHistory(request) },
      });
      return;
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
  const evaluate = await loadEvaluate(request.history?.configDir);
  const metadata = buildEvalHistoryMetadata(request);
  const persistHistory = request.history?.persist !== false;

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

  const result = await evaluate(
    {
      description: buildRunDescription(request),
      writeLatestResults: persistHistory,
      tags: persistHistory ? buildPromptfooHistoryTags(metadata) : undefined,
      metadata:
        request.descriptionCandidates === undefined
          ? undefined
          : { descriptionCandidates: request.descriptionCandidates },
      prompts: ["{{prompt}}"],
      providers,
      tests,
    },
    {
      maxConcurrency: 1,
    },
  );

  const normalizedResult = buildRunResult(request, result);

  writeEvent(output, {
    id: request.id,
    type: "result",
    result: {
      ...normalizedResult,
      history: {
        persisted: Boolean(result.persisted),
        configDir: request.history?.configDir,
        evalId: result.persisted ? result.id : undefined,
        metadata,
      },
    },
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

async function loadEvaluate(configDir?: string): Promise<EvaluateFn> {
  if (configDir) {
    await initializePromptfooConfigDir(configDir);
  }

  if (!promptfooEvaluate) {
    const promptfoo = await import("promptfoo");
    promptfooEvaluate = promptfoo.evaluate;
  }

  return promptfooEvaluate;
}

async function initializePromptfooConfigDir(configDir: string): Promise<void> {
  if (
    activePromptfooConfigDir !== null &&
    activePromptfooConfigDir !== configDir
  ) {
    throw new Error(
      `Promptfoo config dir is fixed for the life of this sidecar process: ${activePromptfooConfigDir}`,
    );
  }

  await mkdir(configDir, { recursive: true });
  process.env.PROMPTFOO_CONFIG_DIR = configDir;
  activePromptfooConfigDir = configDir;
}

function buildRunDescription(request: RunEvalRequest): string {
  return `Eval Workbench ${request.mode} run for ${request.pluginSlug}/${request.skillName} scenario ${request.scenarioName}`;
}

function buildRunResult(
  request: RunEvalRequest,
  result: {
    id?: string;
    persisted?: boolean;
    results?: unknown[];
  },
) {
  const normalized = normalizePromptfooResults(
    request.mode,
    (result.results ?? []) as PromptfooLikeResult[],
  );
  if (
    normalized.total > 0 ||
    !result.persisted ||
    !request.history?.configDir ||
    !result.id
  ) {
    return normalized;
  }

  const entry = readEvalHistory({
    id: request.id,
    type: "read_eval_history",
    configDir: request.history.configDir,
    evalId: result.id,
  });

  return {
    mode: request.mode,
    total: entry.total,
    passed: entry.passed,
    failed: entry.failed,
    results: entry.cases.map((testCase) => ({
      caseId: testCase.caseId ?? `test-${testCase.testIdx}`,
      candidateId: testCase.candidateId ?? `prompt-${testCase.promptIdx}`,
      passed: testCase.success,
      score: testCase.score,
      output: testCase.response ?? null,
      reason:
        testCase.failureReason === undefined
          ? undefined
          : String(testCase.failureReason),
    })),
  };
}

function writeEvent(output: NodeJS.WritableStream, event: SidecarEvent): void {
  output.write(serializeSidecarEvent(event));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runJsonlSidecar();
}
