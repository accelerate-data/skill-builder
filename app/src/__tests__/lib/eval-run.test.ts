import { describe, expect, it } from "vitest";
import {
  buildEvaluateSkillPrompt,
  buildRefinePrefill,
  evalProgressPercent,
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
      workspacePath: "/workspace",
      skillsPath: "/skills",
      evalIds: [1, 3, 5],
      runCount: 3,
    });
    expect(prompt).toContain("skill_name: dbt-quality");
    expect(prompt).toContain("workspace_path: /workspace");
    expect(prompt).toContain("eval_ids: [1,3,5]");
    expect(prompt).toContain("run_count: 3");
    expect(prompt).toContain("skill_path: /skills/dbt-quality");
  });

  it("serializes eval_ids as JSON array", () => {
    const prompt = buildEvaluateSkillPrompt({
      skillName: "s",
      workspacePath: "/w",
      skillsPath: "/s",
      evalIds: [7],
      runCount: 1,
    });
    expect(prompt).toContain("eval_ids: [7]");
  });
});

// --- buildRefinePrefill ---

describe("buildRefinePrefill", () => {
  it("includes failing eval names with pass rates", () => {
    const msg = buildRefinePrefill(makeEvalBenchmark(), []);
    expect(msg).toContain("Scenario B");
    expect(msg).toContain("50%");
  });

  it("does not include fully-passing evals", () => {
    const msg = buildRefinePrefill(makeEvalBenchmark(), []);
    expect(msg).not.toContain("Scenario A");
  });

  it("includes analyst notes when provided", () => {
    const notes = ["Fix example in SKILL.md", "Tighten output format"];
    const msg = buildRefinePrefill(makeEvalBenchmark(), notes);
    expect(msg).toContain("Fix example in SKILL.md");
    expect(msg).toContain("Tighten output format");
  });

  it("includes iteration number", () => {
    const msg = buildRefinePrefill(makeEvalBenchmark(), []);
    expect(msg).toContain("iteration-2");
  });

  it("omits analyst notes section when notes is empty", () => {
    const msg = buildRefinePrefill(makeEvalBenchmark(), []);
    expect(msg).not.toContain("Analyst notes:");
  });

  it("handles 3-run benchmark by averaging per-eval pass rates across runs", () => {
    const bench = makeEvalBenchmark({
      run_count: 3,
      runs: [
        {
          run_index: 0,
          evals: [{ eval_id: 1, eval_name: "Eval X", slug: "eval-x", grading_path: "r0/e1/g.json", summary: { passed: 1, failed: 3, total: 4, pass_rate: 0.25 } }],
          run_summary: { passed: 1, failed: 3, total: 4, pass_rate: 0.25 },
        },
        {
          run_index: 1,
          evals: [{ eval_id: 1, eval_name: "Eval X", slug: "eval-x", grading_path: "r1/e1/g.json", summary: { passed: 2, failed: 2, total: 4, pass_rate: 0.5 } }],
          run_summary: { passed: 2, failed: 2, total: 4, pass_rate: 0.5 },
        },
        {
          run_index: 2,
          evals: [{ eval_id: 1, eval_name: "Eval X", slug: "eval-x", grading_path: "r2/e1/g.json", summary: { passed: 1, failed: 3, total: 4, pass_rate: 0.25 } }],
          run_summary: { passed: 1, failed: 3, total: 4, pass_rate: 0.25 },
        },
      ],
      aggregate_summary: { avg_pass_rate: 0.33, total_passed: 4, total_failed: 8, total_assertions: 12, has_failures: true },
    });
    const msg = buildRefinePrefill(bench, []);
    expect(msg).toContain("Eval X");
    // avg is (0.25+0.5+0.25)/3 ≈ 33%
    expect(msg).toContain("33%");
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
