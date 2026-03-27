import { describe, expect, it } from "vitest";
import {
  buildEvaluateSkillPrompt,
  evalProgressPercent,
  getFailedEvalGradingPaths,
  parseEvalStructuredOutput,
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

// --- buildEvaluateSkillPrompt ---

describe("buildEvaluateSkillPrompt", () => {
  it("includes all required fields", () => {
    const prompt = buildEvaluateSkillPrompt({
      skillName: "dbt-quality",
      pluginSlug: "my-plugin",
      workspacePath: "/workspace",
      skillsPath: "/skill-builder",
      evalIds: [1, 3, 5],
      runCount: 3,
      iteration: 4,
      iterDir: "/workspace/my-plugin/skills/dbt-quality/evals/iterations/iteration-4",
    });
    expect(prompt).toContain("skill_name: dbt-quality");
    expect(prompt).toContain("plugin_slug: my-plugin");
    expect(prompt).toContain("workspace_path: /workspace");
    expect(prompt).toContain("eval_ids: [1,3,5]");
    expect(prompt).toContain("run_count: 3");
    expect(prompt).toContain("skill_path: /skill-builder/my-plugin/skills/dbt-quality");
    expect(prompt).toContain("iteration: 4");
    expect(prompt).toContain("iter_dir: /workspace/my-plugin/skills/dbt-quality/evals/iterations/iteration-4");
  });

  it("serializes eval_ids as JSON array", () => {
    const prompt = buildEvaluateSkillPrompt({
      skillName: "s",
      pluginSlug: "skills",
      workspacePath: "/w",
      skillsPath: "/s",
      evalIds: [7],
      runCount: 1,
      iteration: 1,
      iterDir: "/w/skills/s/evals/iterations/iteration-1",
    });
    expect(prompt).toContain("eval_ids: [7]");
  });

  it("outputs plugin_slug for non-default plugin", () => {
    const prompt = buildEvaluateSkillPrompt({
      skillName: "my-skill",
      pluginSlug: "analytics",
      workspacePath: "/workspace",
      skillsPath: "/skill-builder",
      evalIds: [1],
      runCount: 1,
      iteration: 1,
      iterDir: "/workspace/analytics/skills/my-skill/evals/iterations/iteration-1",
    });
    expect(prompt).toContain("plugin_slug: analytics");
  });

  it("outputs plugin_slug for default plugin", () => {
    const prompt = buildEvaluateSkillPrompt({
      skillName: "my-skill",
      pluginSlug: "skills",
      workspacePath: "/workspace",
      skillsPath: "/skill-builder",
      evalIds: [1],
      runCount: 1,
      iteration: 1,
      iterDir: "/workspace/skills/my-skill/evals/iterations/iteration-1",
    });
    expect(prompt).toContain("plugin_slug: skills");
  });
});

// --- getFailedEvalGradingPaths ---

describe("getFailedEvalGradingPaths", () => {
  it("returns only evals with avg pass_rate < 1.0", () => {
    const result = getFailedEvalGradingPaths(makeEvalBenchmark());
    expect(result).toHaveLength(1);
    expect(result[0].eval_id).toBe(2);
    expect(result[0].eval_name).toBe("Scenario B");
    expect(result[0].grading_path).toBe("run-0/eval-2-scenario-b/grading.json");
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
    // avg ≈ 0.83 < 1.0
    expect(getFailedEvalGradingPaths(bench)).toHaveLength(1);
  });
});

// --- parseEvalStructuredOutput ---

describe("parseEvalStructuredOutput", () => {
  it("returns EvalGradedEvent for eval_graded type", () => {
    const input = {
      type: "eval_graded",
      runIndex: 0,
      evalIndex: 1,
      totalEvals: 3,
      totalRuns: 1,
      evalId: 2,
      evalName: "Scenario B",
      grading: { passed: 2, failed: 2, total: 4, pass_rate: 0.5 },
    };
    const result = parseEvalStructuredOutput(input);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("eval_graded");
  });

  it("returns EvalCompleteEvent for complete type", () => {
    const input = {
      type: "complete",
      iteration: 3,
      benchmark: makeEvalBenchmark(),
      analyst_notes: ["note one"],
    };
    const result = parseEvalStructuredOutput(input);
    expect(result?.type).toBe("complete");
  });

  it("returns null for unrecognised type", () => {
    expect(parseEvalStructuredOutput({ type: "unknown" })).toBeNull();
    expect(parseEvalStructuredOutput(null)).toBeNull();
    expect(parseEvalStructuredOutput("string")).toBeNull();
    expect(parseEvalStructuredOutput(42)).toBeNull();
  });
});

// --- evalProgressPercent ---

describe("evalProgressPercent", () => {
  it("returns 0 when nothing graded", () => {
    expect(evalProgressPercent(0, 3, 1)).toBe(0);
  });

  it("returns 100 when all graded", () => {
    expect(evalProgressPercent(3, 3, 1)).toBe(100);
    expect(evalProgressPercent(9, 3, 3)).toBe(100);
  });

  it("returns proportional value mid-run", () => {
    // 2 of 6 graded (2 evals × 3 runs)
    expect(evalProgressPercent(2, 2, 3)).toBe(33);
  });

  it("returns 0 when total is 0", () => {
    expect(evalProgressPercent(0, 0, 0)).toBe(0);
  });
});
