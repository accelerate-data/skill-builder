import { mkdtemp, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { serializeSidecarRequest } from "../protocol.js";
import { runJsonlSidecar } from "../runner.js";

let historyConfigDir = "";

async function runSidecarForInput(inputText: string) {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];

  output.on("data", (chunk: string | Buffer) => {
    chunks.push(String(chunk));
  });

  const pending = runJsonlSidecar(input, output);
  input.end(inputText);
  await pending;

  return chunks
    .join("")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

async function runSidecarForRequest(request: SidecarRequest) {
  return runSidecarForInput(serializeSidecarRequest(request));
}

async function buildRunEvalRequest(
  request: Omit<
    Extract<Parameters<typeof serializeSidecarRequest>[0], { type: "run_eval" }>,
    "scenarioName" | "promptfooConfigDir"
  > &
    Partial<
      Pick<
        Extract<Parameters<typeof serializeSidecarRequest>[0], { type: "run_eval" }>,
        "scenarioName" | "promptfooConfigDir"
      >
    >,
) {
  return {
    scenarioName: request.scenarioName ?? "Routing checks",
    promptfooConfigDir:
      request.promptfooConfigDir ??
      (await mkdtemp(join(tmpdir(), "promptfoo-sidecar-run-"))),
    ...request,
  } as Extract<
    Parameters<typeof serializeSidecarRequest>[0],
    { type: "run_eval" }
  >;
}

describe("promptfoo sidecar runner", () => {
  beforeAll(async () => {
    historyConfigDir = await mkdtemp(
      join(tmpdir(), "skill-builder-promptfoo-sidecar-"),
    );
  });

  it("persists app-owned history and can list plus read it back", async () => {
    const runEvents = await runSidecarForRequest(
      buildRunEvalRequest({
        id: "run-history",
        mode: "trigger",
        skillName: "forecast-revenue",
        scenarioName: "Trigger smoke",
        history: {
          configDir: historyConfigDir,
          persist: true,
        },
        cases: [
          {
            id: "case-1",
            prompt: "Forecast revenue for next quarter",
            shouldTrigger: true,
            assertions: [],
          },
        ],
        executions: [
          {
            caseId: "case-1",
            candidateId: "baseline",
            output: { invokedTargetSkill: true, responseText: "Triggered" },
          },
        ],
      }),
    );

    const resultEvent = runEvents.find((event) => event.type === "result");
    expect(resultEvent?.result).toMatchObject({
      mode: "trigger",
      total: 1,
      passed: 1,
      failed: 0,
      history: {
        persisted: true,
        configDir: historyConfigDir,
        evalId: expect.any(String),
        metadata: {
          source: "eval_workbench",
          pluginSlug: "skills",
          skillName: "forecast-revenue",
          scenarioName: "Trigger smoke",
          mode: "trigger",
        },
      },
    });

    const evalId = resultEvent?.result.history?.evalId;
    expect(typeof evalId).toBe("string");

    const listEvents = await runSidecarForRequest({
      id: "list-history",
      type: "list_eval_history",
      filter: {
        configDir: historyConfigDir,
        pluginSlug: "skills",
        skillName: "forecast-revenue",
        scenarioName: "Trigger smoke",
        mode: "trigger",
        limit: 10,
        offset: 0,
      },
    });

    expect(listEvents).toContainEqual(
      expect.objectContaining({
        id: "list-history",
        type: "history_list_result",
        result: expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({
              evalId,
              metadata: expect.objectContaining({
                pluginSlug: "skills",
                skillName: "forecast-revenue",
                scenarioName: "Trigger smoke",
                mode: "trigger",
              }),
              total: 1,
              passed: 1,
              failed: 0,
            }),
          ]),
        }),
      }),
    );

    const readEvents = await runSidecarForRequest({
      id: "read-history",
      type: "read_eval_history",
      configDir: historyConfigDir,
      evalId: String(evalId),
    });

    expect(readEvents).toContainEqual(
      expect.objectContaining({
        id: "read-history",
        type: "history_read_result",
        result: expect.objectContaining({
          entry: expect.objectContaining({
            evalId,
            metadata: expect.objectContaining({
              scenarioName: "Trigger smoke",
              mode: "trigger",
            }),
            cases: [
              expect.objectContaining({
                caseId: "case-1",
                candidateId: "baseline",
                success: true,
                providerId: "baseline",
              }),
            ],
          }),
        }),
      }),
    );
  });

  it("evaluates trigger cases and emits progress plus result events", async () => {
    const events = await runSidecarForRequest(await buildRunEvalRequest({
      id: "run-trigger",
      type: "run_eval",
      mode: "trigger",
        skillName: "forecast revenue",
        pluginSlug: "skills",
        scenarioName: "Routing checks",
        promptfooConfigDir: "/tmp/promptfoo-sidecar",
        candidates: [
        {
          id: "baseline",
          label: "Baseline",
          description:
            "Trigger for revenue forecasting and sales planning requests.",
        },
      ],
      cases: [
        {
          id: "case-1",
          prompt: "Forecast revenue for next quarter",
          shouldTrigger: true,
          assertions: [
            { type: "javascript", value: "output.invokedTargetSkill === true" },
          ],
        },
        {
          id: "case-2",
          prompt: "Write a vacation itinerary",
          shouldTrigger: false,
          assertions: [],
        },
      ],
      executions: [
        {
          caseId: "case-1",
          candidateId: "baseline",
          output: { invokedTargetSkill: true, responseText: "Triggered" },
        },
        {
          caseId: "case-2",
          candidateId: "baseline",
          output: { invokedTargetSkill: false, responseText: "Did not trigger" },
        },
      ],
    }));

    expect(events.filter((event) => event.type === "progress")).toHaveLength(2);
    const resultEvent = events.find((event) => event.type === "result");
    expect(resultEvent?.result).toMatchObject({
      mode: "trigger",
      total: 2,
      passed: 2,
      failed: 0,
      history: {
        persisted: false,
      },
    });
  });

  it("fails performance cases when expected text is missing", async () => {
    const events = await runSidecarForRequest(await buildRunEvalRequest({
      id: "run-performance",
      type: "run_eval",
      mode: "performance",
        skillName: "docs-helper",
        pluginSlug: "skills",
        scenarioName: "Regression",
        promptfooConfigDir: "/tmp/promptfoo-sidecar",
        candidates: [
        {
          id: "current",
          label: "Current skill",
          description: "Summarize docs and explain configuration decisions.",
        },
      ],
      cases: [
        {
          id: "case-1",
          prompt: "Explain the deployment guide",
          expected: "incident response",
          assertions: [],
        },
      ],
      executions: [
        {
          caseId: "case-1",
          candidateId: "current",
          output: { responseText: "Deployment guide summary only" },
        },
      ],
    }));

    const resultEvent = events.find((event) => event.type === "result");
    expect(resultEvent?.result).toMatchObject({
      mode: "performance",
      total: 1,
      passed: 0,
      failed: 1,
    });
    expect(resultEvent?.result.results[0]?.passed).toBe(false);
  });

  it("records a failed result when execution output is missing", async () => {
    const events = await runSidecarForRequest(await buildRunEvalRequest({
      id: "run-missing-output",
      type: "run_eval",
      mode: "trigger",
        skillName: "forecast revenue",
        pluginSlug: "skills",
        scenarioName: "Routing checks",
        promptfooConfigDir: "/tmp/promptfoo-sidecar",
        candidates: [{ id: "baseline", label: "Baseline" }],
      cases: [
        {
          id: "case-1",
          prompt: "Forecast revenue for next quarter",
          shouldTrigger: true,
          assertions: [],
        },
      ],
      executions: [],
    }));

    expect(events).toContainEqual(
      expect.objectContaining({
        id: "run-missing-output",
        type: "result",
        result: expect.objectContaining({
          failed: 1,
          results: [
            expect.objectContaining({
              candidateId: "baseline",
              caseId: "case-1",
              passed: false,
              score: 0,
            }),
          ],
        }),
      }),
    );
  });

  it("emits an unknown-scoped error for malformed input", async () => {
    const events = await runSidecarForInput('{"type":"run_eval"}\n');

    expect(events).toContainEqual(
      expect.objectContaining({
        id: "unknown",
        type: "error",
      }),
    );
  });

  it("writes persisted state to the requested promptfoo directory and reads completed history back", async () => {
    const promptfooConfigDir = await mkdtemp(
      join(tmpdir(), "promptfoo-sidecar-history-"),
    );
    const runEvalEvents = await runSidecarForInput(
      `${JSON.stringify({
        id: "run-history",
        type: "run_eval",
        mode: "trigger",
        skillName: "forecast revenue",
        pluginSlug: "skills",
        scenarioName: "Routing checks",
        promptfooConfigDir,
        candidates: [{ id: "baseline", label: "Baseline" }],
        cases: [
          {
            id: "case-1",
            prompt: "Forecast revenue for next quarter",
            shouldTrigger: true,
            assertions: [],
          },
        ],
        executions: [
          {
            caseId: "case-1",
            candidateId: "baseline",
            output: { invokedTargetSkill: true, responseText: "Triggered" },
          },
        ],
      })}\n`,
    );

    expect(runEvalEvents).toContainEqual(
      expect.objectContaining({
        id: "run-history",
        type: "result",
      }),
    );
    expect(await readdir(promptfooConfigDir)).toEqual(
      expect.arrayContaining(["promptfoo.db", "evalLastWritten"]),
    );

    const listEvents = await runSidecarForInput(
      `${JSON.stringify({
        id: "list-history",
        type: "list_history",
        promptfooConfigDir,
        pluginSlug: "skills",
        skillName: "forecast revenue",
        scenarioName: "Routing checks",
        mode: "trigger",
        limit: 10,
      })}\n`,
    );
    expect(listEvents).toContainEqual(
      expect.objectContaining({
        id: "list-history",
        type: "result",
        runs: [
          expect.objectContaining({
            id: "run-history",
            scenarioName: "Routing checks",
            mode: "trigger",
            status: "completed",
            scenarioSnapshot: expect.objectContaining({
              scenarioName: "Routing checks",
              mode: "trigger",
            }),
          }),
        ],
      }),
    );

    const readEvents = await runSidecarForInput(
      `${JSON.stringify({
        id: "read-history",
        type: "read_history",
        promptfooConfigDir,
        runId: "run-history",
      })}\n`,
    );
    expect(readEvents).toContainEqual(
      expect.objectContaining({
        id: "read-history",
        type: "result",
        run: expect.objectContaining({
          id: "run-history",
          scenarioName: "Routing checks",
          mode: "trigger",
          status: "completed",
          scenarioSnapshot: expect.objectContaining({
            scenarioName: "Routing checks",
          }),
          results: [
            expect.objectContaining({
              caseId: "case-1",
              candidateId: "baseline",
              passed: true,
            }),
          ],
        }),
      }),
    );
  });

  it("filters persisted history by scenario identity", async () => {
    const promptfooConfigDir = await mkdtemp(
      join(tmpdir(), "promptfoo-sidecar-filter-"),
    );

    await runSidecarForRequest(await buildRunEvalRequest({
      id: "run-routing",
      type: "run_eval",
      mode: "trigger",
      skillName: "forecast revenue",
      pluginSlug: "skills",
      scenarioName: "Routing checks",
      promptfooConfigDir,
      candidates: [{ id: "baseline", label: "Baseline" }],
      cases: [
        {
          id: "case-1",
          prompt: "Forecast revenue for next quarter",
          shouldTrigger: true,
          assertions: [],
        },
      ],
      executions: [
        {
          caseId: "case-1",
          candidateId: "baseline",
          output: { invokedTargetSkill: true, responseText: "Triggered" },
        },
      ],
    }));

    await runSidecarForRequest(await buildRunEvalRequest({
      id: "run-regression",
      type: "run_eval",
      mode: "trigger",
      skillName: "forecast revenue",
      pluginSlug: "skills",
      scenarioName: "Regression",
      promptfooConfigDir,
      candidates: [{ id: "baseline", label: "Baseline" }],
      cases: [
        {
          id: "case-1",
          prompt: "Summarize backlog risk",
          shouldTrigger: false,
          assertions: [],
        },
      ],
      executions: [
        {
          caseId: "case-1",
          candidateId: "baseline",
          output: { invokedTargetSkill: false, responseText: "Ignored" },
        },
      ],
    }));

    const listEvents = await runSidecarForInput(
      `${JSON.stringify({
        id: "list-history-filtered",
        type: "list_history",
        promptfooConfigDir,
        pluginSlug: "skills",
        skillName: "forecast revenue",
        scenarioName: "Routing checks",
        mode: "trigger",
        limit: 10,
      })}\n`,
    );

    expect(listEvents).toContainEqual(
      expect.objectContaining({
        id: "list-history-filtered",
        type: "result",
        runs: [
          expect.objectContaining({
            id: "run-routing",
            scenarioName: "Routing checks",
          }),
        ],
      }),
    );

    const resultEvent = listEvents.find((event) => event.type === "result");
    expect(resultEvent?.runs).toHaveLength(1);
    expect(resultEvent?.runs[0]?.id).toBe("run-routing");
  });

  it("applies history limits before returning grouped runs", async () => {
    const promptfooConfigDir = await mkdtemp(
      join(tmpdir(), "promptfoo-sidecar-limit-"),
    );

    await runSidecarForRequest(await buildRunEvalRequest({
      id: "run-older",
      type: "run_eval",
      mode: "trigger",
      skillName: "forecast revenue",
      pluginSlug: "skills",
      scenarioName: "Routing checks",
      promptfooConfigDir,
      candidates: [{ id: "baseline", label: "Baseline" }],
      cases: [
        {
          id: "case-1",
          prompt: "Forecast revenue for next quarter",
          shouldTrigger: true,
          assertions: [],
        },
      ],
      executions: [
        {
          caseId: "case-1",
          candidateId: "baseline",
          output: { invokedTargetSkill: true, responseText: "Triggered" },
        },
      ],
    }));

    await runSidecarForRequest(await buildRunEvalRequest({
      id: "run-latest",
      type: "run_eval",
      mode: "trigger",
      skillName: "forecast revenue",
      pluginSlug: "skills",
      scenarioName: "Routing checks",
      promptfooConfigDir,
      candidates: [{ id: "baseline", label: "Baseline" }],
      cases: [
        {
          id: "case-1",
          prompt: "Forecast revenue for next quarter",
          shouldTrigger: true,
          assertions: [],
        },
      ],
      executions: [
        {
          caseId: "case-1",
          candidateId: "baseline",
          output: { invokedTargetSkill: true, responseText: "Triggered again" },
        },
      ],
    }));

    const listEvents = await runSidecarForInput(
      `${JSON.stringify({
        id: "list-history-limited",
        type: "list_history",
        promptfooConfigDir,
        pluginSlug: "skills",
        skillName: "forecast revenue",
        scenarioName: "Routing checks",
        mode: "trigger",
        limit: 1,
      })}\n`,
    );

    const resultEvent = listEvents.find((event) => event.type === "result");
    expect(resultEvent?.runs).toHaveLength(1);
    expect(resultEvent?.runs[0]?.id).toBe("run-latest");
  });
});
