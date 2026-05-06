import { spawn } from "node:child_process";
import { mkdtemp, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { serializeSidecarRequest } from "../protocol.js";
import { runJsonlSidecar } from "../runner.js";

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
    .map((line) => JSON.parse(line));
}

async function runSidecarForRequest(
  request: Parameters<typeof serializeSidecarRequest>[0],
) {
  return runSidecarForInput(serializeSidecarRequest(request));
}

async function runSidecarCliForRequest(
  request: Parameters<typeof serializeSidecarRequest>[0],
) {
  const tsxCliPath = fileURLToPath(
    new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url),
  );
  const runnerPath = fileURLToPath(new URL("../runner.ts", import.meta.url));

  return await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCliPath, runnerPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    child.stdout.on("data", (chunk: string | Buffer) => {
      stdoutChunks.push(String(chunk));
    });
    child.stderr.on("data", (chunk: string | Buffer) => {
      stderrChunks.push(String(chunk));
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `runner CLI exited with code ${code ?? -1}: ${stderrChunks.join("").trim()}`,
          ),
        );
        return;
      }

      resolve(
        stdoutChunks
          .join("")
          .trim()
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line)),
      );
    });

    child.stdin.write(serializeSidecarRequest(request));
    child.stdin.end();
  });
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
    }));

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

  it("supports the CLI entrypoint for run_eval requests", async () => {
    const promptfooConfigDir = await mkdtemp(
      join(tmpdir(), "promptfoo-sidecar-cli-"),
    );

    const events = await runSidecarCliForRequest(await buildRunEvalRequest({
      id: "run-cli",
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

    expect(events).toContainEqual(
      expect.objectContaining({
        id: "run-cli",
        type: "result",
        result: expect.objectContaining({
          mode: "trigger",
          total: 1,
          passed: 1,
          failed: 0,
        }),
      }),
    );
  });
});
