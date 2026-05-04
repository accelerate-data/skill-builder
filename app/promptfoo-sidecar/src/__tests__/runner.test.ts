import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { serializeSidecarRequest } from "../protocol.js";
import { runJsonlSidecar } from "../runner.js";

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
    .map((line) => JSON.parse(line));
}

async function runSidecarForRequest(
  request: Parameters<typeof serializeSidecarRequest>[0],
) {
  return runSidecarForInput(serializeSidecarRequest(request));
}

describe("promptfoo sidecar runner", () => {
  it("evaluates trigger cases and emits progress plus result events", async () => {
    const events = await runSidecarForRequest({
      id: "run-trigger",
      type: "run_eval",
      mode: "trigger",
      skillName: "forecast revenue",
      pluginSlug: "skills",
      candidates: [
        {
          id: "baseline",
          label: "Baseline",
          description: "Trigger for revenue forecasting and sales planning requests.",
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
    });
  });

  it("fails performance cases when expected text is missing", async () => {
    const events = await runSidecarForRequest({
      id: "run-performance",
      type: "run_eval",
      mode: "performance",
      skillName: "docs-helper",
      pluginSlug: "skills",
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
    });

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
    const events = await runSidecarForRequest({
      id: "run-missing-output",
      type: "run_eval",
      mode: "trigger",
      skillName: "forecast revenue",
      pluginSlug: "skills",
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
    });

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
