import { evaluate } from "promptfoo";

function executionKey(caseId, candidateId) {
  return `${candidateId}::${caseId}`;
}

function toPromptfooAssertion(assertion) {
  return {
    type: assertion.type,
    value:
      typeof assertion.value === "string"
        ? assertion.value
        : JSON.stringify(assertion.value),
  };
}

function buildAssertions(testCase) {
  const assertions = testCase.assertions.map(toPromptfooAssertion);
  if (testCase.expected) {
    assertions.push({ type: "contains", value: testCase.expected });
  }
  if (typeof testCase.shouldTrigger === "boolean") {
    assertions.push({
      type: "javascript",
      value: `output?.invokedTargetSkill === ${String(testCase.shouldTrigger)}`,
    });
  }
  return assertions;
}

function buildExecutionMap(executions) {
  return new Map(
    executions.map((execution) => [
      executionKey(execution.caseId, execution.candidateId),
      execution.output,
    ]),
  );
}

function buildProviders(candidates, executionMap) {
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

function buildTests(request, cases) {
  return cases.map((testCase) => ({
    vars: {
      caseId: testCase.id,
      prompt: testCase.prompt,
    },
    metadata: {
      pluginSlug: request.pluginSlug,
      skillName: request.skillName,
      scenarioName: request.scenarioName,
      mode: request.mode,
      runId: request.id,
      caseId: testCase.id,
      scenarioSnapshot: {
        pluginSlug: request.pluginSlug,
        skillName: request.skillName,
        scenarioName: request.scenarioName,
        mode: request.mode,
        cases: request.cases.map((scenarioCase, index) => ({
          id: scenarioCase.id,
          prompt: scenarioCase.prompt,
          expected: scenarioCase.expected,
          shouldTrigger: scenarioCase.shouldTrigger,
          assertions: scenarioCase.assertions,
          sortOrder: index,
        })),
      },
    },
    assert: buildAssertions(testCase),
  }));
}

async function readRequestFromStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk).toString("utf8"));
  }
  return JSON.parse(chunks.join(""));
}

async function main() {
  const request = await readRequestFromStdin();
  const executionMap = buildExecutionMap(request.executions);
  const providers = buildProviders(request.candidates, executionMap);
  const tests = buildTests(request, request.cases);

  await evaluate(
    {
      prompts: ["{{prompt}}"],
      providers,
      tests,
      writeLatestResults: true,
    },
    { maxConcurrency: 1 },
  );
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
