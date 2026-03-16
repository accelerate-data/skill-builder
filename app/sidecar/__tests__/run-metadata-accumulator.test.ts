import { describe, it, expect, beforeEach } from "vitest";
import { RunMetadataAccumulator } from "../run-metadata-accumulator.js";
import type { RequestContext } from "../run-metadata-accumulator.js";

describe("RunMetadataAccumulator", () => {
  let accumulator: RunMetadataAccumulator;
  const context: RequestContext = {
    skillName: "test-skill",
    stepId: 1,
    workflowSessionId: "ws-123",
    usageSessionId: "us-456",
    runSource: "workflow",
  };

  beforeEach(() => {
    accumulator = new RunMetadataAccumulator(context);
  });

  it("starts with zero turn count", () => {
    expect(accumulator.currentTurnCount).toBe(0);
  });

  it("increments turn count", () => {
    accumulator.recordTurn();
    accumulator.recordTurn();
    expect(accumulator.currentTurnCount).toBe(2);
  });

  it("returns context via getContext", () => {
    expect(accumulator.getContext()).toBe(context);
  });

  describe("buildShutdownSummary", () => {
    it("returns a run_result with shutdown status", () => {
      accumulator.recordTurn();
      accumulator.recordToolUse();
      accumulator.recordCompaction();

      const summary = accumulator.buildShutdownSummary();
      expect(summary.type).toBe("run_result");
      expect(summary.status).toBe("shutdown");
      expect(summary.skillName).toBe("test-skill");
      expect(summary.stepId).toBe(1);
      expect(summary.numTurns).toBe(1);
      expect(summary.toolUseCount).toBe(1);
      expect(summary.compactionCount).toBe(1);
      expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("buildExecutionErrorSummary", () => {
    it("returns a run_result with error status", () => {
      const summary = accumulator.buildExecutionErrorSummary("Something broke");
      expect(summary.type).toBe("run_result");
      expect(summary.status).toBe("error");
      expect(summary.resultErrors).toEqual(["Something broke"]);
    });
  });

  describe("buildRunSummary", () => {
    it("returns completed status for success", () => {
      const summary = accumulator.buildRunSummary({ subtype: "success" });
      expect(summary.status).toBe("completed");
      expect(summary.skillName).toBe("test-skill");
    });

    it("returns error status for error subtype", () => {
      const summary = accumulator.buildRunSummary({
        subtype: "error_max_turns",
        is_error: true,
        errors: ["Too many turns"],
      });
      expect(summary.status).toBe("error");
      expect(summary.resultSubtype).toBe("error_max_turns");
      expect(summary.resultErrors).toEqual(["Too many turns"]);
    });

    it("aggregates model usage breakdown", () => {
      const summary = accumulator.buildRunSummary({
        modelUsage: {
          "claude-3": {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadInputTokens: 10,
            cacheCreationInputTokens: 5,
            costUSD: 0.01,
            contextWindow: 200000,
          },
        },
      });
      expect(summary.inputTokens).toBe(100);
      expect(summary.outputTokens).toBe(50);
      expect(summary.cacheReadTokens).toBe(10);
      expect(summary.cacheWriteTokens).toBe(5);
      expect(summary.totalCostUsd).toBe(0.01);
      expect(summary.contextWindow).toBe(200000);
      expect(summary.modelUsageBreakdown).toHaveLength(1);
    });

    it("records session init data", () => {
      accumulator.recordSessionInit("sess-abc", "claude-4");
      const summary = accumulator.buildRunSummary({});
      expect(summary.sessionId).toBe("sess-abc");
      expect(summary.model).toBe("claude-4");
    });
  });

  describe("defaults for missing context", () => {
    it("uses defaults when context fields are missing", () => {
      const sparse = new RunMetadataAccumulator({});
      const summary = sparse.buildShutdownSummary();
      expect(summary.skillName).toBe("unknown");
      expect(summary.stepId).toBe(-1);
    });
  });
});
