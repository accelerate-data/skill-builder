import { describe, expect, it } from "vitest";
import {
  getFailedEvalGradingPaths,
} from "@/lib/eval-run";
import type { EvalBenchmark } from "@/lib/types";

// --- Fixtures ---

function makeEvalBenchmark(overrides?: Partial<EvalBenchmark>): EvalBenchmark {
  return {
    skill_name: "test-skill",
    iteration: 2,
    run_count: 1,
    eval_ids: [1, 2],
    runs: [
      {
        run_index: 0,
        evals: [
          {
            eval_id: 1,
            eval_name: "Scenario A",
            slug: "scenario-a",
            grading_path: "run-0/eval-1-scenario-a/grading.json",
            summary: { passed: 4, failed: 0, total: 4, pass_rate: 1.0 },
          },
          {
            eval_id: 2,
            eval_name: "Scenario B",
            slug: "scenario-b",
            grading_path: "run-0/eval-2-scenario-b/grading.json",
            summary: { passed: 2, failed: 2, total: 4, pass_rate: 0.5 },
          },
        ],
        run_summary: { passed: 6, failed: 2, total: 8, pass_rate: 0.75 },
      },
    ],
    aggregate_summary: {
      avg_pass_rate: 0.75,
      total_passed: 6,
      total_failed: 2,
      total_assertions: 8,
      has_failures: true,
    },
    ...overrides,
  };
}

// --- getFailedEvalGradingPaths ---

describe("getFailedEvalGradingPaths", () => {
  it("returns only evals with failed > 0 in any run", () => {
    const result = getFailedEvalGradingPaths(makeEvalBenchmark());
    expect(result).toHaveLength(1);
    expect(result[0].eval_id).toBe(2);
    expect(result[0].eval_name).toBe("Scenario B");
    expect(result[0].grading_paths).toContain("run-0/eval-2-scenario-b/grading.json");
  });

  it("returns empty array when all evals pass", () => {
    const bench = makeEvalBenchmark({
      runs: [{
        run_index: 0,
        evals: [{ eval_id: 1, eval_name: "A", slug: "a", grading_path: "g1.json", summary: { passed: 4, failed: 0, total: 4, pass_rate: 1.0 } }],
        run_summary: { passed: 4, failed: 0, total: 4, pass_rate: 1.0 },
      }],
    });
    expect(getFailedEvalGradingPaths(bench)).toHaveLength(0);
  });

  it("averages pass rates across multiple runs", () => {
    const bench = makeEvalBenchmark({
      run_count: 3,
      runs: [
        { run_index: 0, evals: [{ eval_id: 1, eval_name: "X", slug: "x", grading_path: "r0.json", summary: { passed: 4, failed: 0, total: 4, pass_rate: 1.0 } }], run_summary: { passed: 4, failed: 0, total: 4, pass_rate: 1.0 } },
        { run_index: 1, evals: [{ eval_id: 1, eval_name: "X", slug: "x", grading_path: "r1.json", summary: { passed: 2, failed: 2, total: 4, pass_rate: 0.5 } }], run_summary: { passed: 2, failed: 2, total: 4, pass_rate: 0.5 } },
        { run_index: 2, evals: [{ eval_id: 1, eval_name: "X", slug: "x", grading_path: "r2.json", summary: { passed: 4, failed: 0, total: 4, pass_rate: 1.0 } }], run_summary: { passed: 4, failed: 0, total: 4, pass_rate: 1.0 } },
      ],
    });
    // run-1 failed (failed > 0) → only r1.json collected
    const result = getFailedEvalGradingPaths(bench);
    expect(result).toHaveLength(1);
    expect(result[0].grading_paths).toEqual(["r1.json"]);
  });
});

