import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { beforeAll, describe, expect, it } from "vitest";
import { serializeSidecarRequest, type SidecarRequest } from "../protocol.js";
import { runJsonlSidecar } from "../runner.js";

let historyConfigDir = "";

async function runSidecarForInput(inputText: string) {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];

  output.on("data", (chunk) => {
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

function buildRunEvalRequest(
  overrides: Partial<Extract<SidecarRequest, { type: "run_eval" }>> = {},
): Extract<SidecarRequest, { type: "run_eval" }> {
  return {
    id: "run-default",
    type: "run_eval",
    mode: "performance",
    skillName: "docs-helper",
    pluginSlug: "skills",
    scenarioName: "Smoke",
    history: {
      configDir: historyConfigDir,
      persist: false,
    },
    candidates: [
      {
        id: "baseline",
        label: "Baseline",
      },
    ],
    cases: [
      {
        id: "case-1",
        prompt: "Explain the deployment guide",
        assertions: [],
      },
    ],
    executions: [
      {
        caseId: "case-1",
        candidateId: "baseline",
        output: { responseText: "Deployment guide summary only" },
      },
    ],
    ...overrides,
  };
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
    const events = await runSidecarForRequest({
      id: "run-trigger",
      type: "run_eval",
      mode: "trigger",
      skillName: "forecast revenue",
      pluginSlug: "skills",
      scenarioName: "Trigger coverage",
      history: {
        configDir: historyConfigDir,
        persist: false,
      },
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
    });

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

  it("records failed performance results when assertions fail", async () => {
    const events = await runSidecarForRequest(
      buildRunEvalRequest({
        id: "run-performance",
        history: {
          configDir: historyConfigDir,
          persist: false,
        },
        cases: [
          {
            id: "case-1",
            prompt: "Explain the deployment guide",
            assertions: [{ type: "javascript", value: "false" }],
          },
        ],
      }),
    );

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
    const events = await runSidecarForRequest(
      buildRunEvalRequest({
        id: "run-missing-output",
        mode: "trigger",
        scenarioName: "Missing output",
        history: {
          configDir: historyConfigDir,
          persist: false,
        },
        cases: [
          {
            id: "case-1",
            prompt: "Forecast revenue for next quarter",
            shouldTrigger: true,
            assertions: [],
          },
        ],
        executions: [],
      }),
    );

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
});
