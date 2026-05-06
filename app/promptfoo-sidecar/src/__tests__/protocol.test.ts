import { describe, expect, it } from "vitest";
import { parseSidecarRequest, serializeSidecarEvent } from "../protocol.js";

describe("promptfoo sidecar protocol", () => {
  it("parses a valid run_eval request", () => {
    const request = parseSidecarRequest(
      JSON.stringify({
        id: "run-1",
        type: "run_eval",
        mode: "trigger",
        skillName: "creating-skills",
        pluginSlug: "skill-creator",
        scenarioName: "Routing checks",
        promptfooConfigDir: "/tmp/promptfoo-sidecar",
        candidates: [
          {
            id: "baseline",
            label: "Baseline",
            description: "Create high quality skills.",
          },
        ],
        cases: [
          {
            id: "case-1",
            prompt: "Help me create a skill",
            shouldTrigger: true,
            assertions: [{ type: "equals", value: "true" }],
          },
        ],
        executions: [
          {
            caseId: "case-1",
            candidateId: "baseline",
            output: { invokedTargetSkill: true },
          },
        ],
      }),
    );

    expect(request).toMatchObject({
      id: "run-1",
      type: "run_eval",
      mode: "trigger",
      skillName: "creating-skills",
      pluginSlug: "skill-creator",
      scenarioName: "Routing checks",
      promptfooConfigDir: "/tmp/promptfoo-sidecar",
    });
    expect(request.type).toBe("run_eval");
    if (request.type !== "run_eval") {
      throw new Error("Expected run_eval request");
    }
    expect(request.candidates).toHaveLength(1);
    expect(request.cases[0]?.assertions[0]).toEqual({
      type: "equals",
      value: "true",
    });
  });

  it("parses a valid list_eval_history request", () => {
    const request = parseSidecarRequest(
      JSON.stringify({
        id: "list-1",
        type: "list_eval_history",
        filter: {
          configDir: "/tmp/promptfoo-sidecar-tests",
          pluginSlug: "skill-creator",
          skillName: "creating-skills",
          scenarioName: "Smoke",
          mode: "trigger",
          limit: 10,
          offset: 0,
        },
      }),
    );

    expect(request).toEqual({
      id: "list-1",
      type: "list_eval_history",
      filter: {
        configDir: "/tmp/promptfoo-sidecar-tests",
        pluginSlug: "skill-creator",
        skillName: "creating-skills",
        scenarioName: "Smoke",
        mode: "trigger",
        limit: 10,
        offset: 0,
      },
    });
  });

  it("parses a valid read_eval_history request", () => {
    const request = parseSidecarRequest(
      JSON.stringify({
        id: "read-1",
        type: "read_eval_history",
        configDir: "/tmp/promptfoo-sidecar-tests",
        evalId: "eval-123",
      }),
    );

    expect(request).toEqual({
      id: "read-1",
      type: "read_eval_history",
      configDir: "/tmp/promptfoo-sidecar-tests",
      evalId: "eval-123",
    });
  });

  it("rejects unsupported request types", () => {
    expect(() =>
      parseSidecarRequest(
        JSON.stringify({
          id: "run-1",
          type: "provider_result",
        }),
      ),
    ).toThrow("Unsupported sidecar request type: provider_result");
  });

  it("serializes sidecar events as newline-delimited JSON", () => {
    expect(
      serializeSidecarEvent({
        id: "run-1",
        type: "progress",
        completed: 1,
        total: 2,
        caseId: "case-1",
      }),
    ).toBe(
      '{"id":"run-1","type":"progress","completed":1,"total":2,"caseId":"case-1"}\n',
    );
  });
});
