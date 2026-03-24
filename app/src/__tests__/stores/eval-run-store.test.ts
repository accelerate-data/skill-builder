import { describe, expect, it, beforeEach } from "vitest";
import { useEvalRunStore } from "@/stores/eval-run-store";
import type { EvalBenchmark } from "@/lib/types";

function makeBenchmark(): EvalBenchmark {
  return {
    skill_name: "test-skill",
    iteration: 1,
    run_count: 1,
    eval_ids: [1],
    runs: [
      {
        run_index: 0,
        evals: [
          {
            eval_id: 1,
            eval_name: "Eval A",
            slug: "eval-a",
            grading_path: "run-0/eval-1/grading.json",
            summary: { passed: 3, failed: 1, total: 4, pass_rate: 0.75 },
          },
        ],
        run_summary: { passed: 3, failed: 1, total: 4, pass_rate: 0.75 },
      },
    ],
    aggregate_summary: {
      avg_pass_rate: 0.75,
      total_passed: 3,
      total_failed: 1,
      total_assertions: 4,
      has_failures: true,
    },
  };
}

describe("useEvalRunStore", () => {
  beforeEach(() => {
    useEvalRunStore.getState().clearEvalRunResult();
  });

  it("starts with null benchmark and empty notes", () => {
    const { benchmark, analystNotes } = useEvalRunStore.getState();
    expect(benchmark).toBeNull();
    expect(analystNotes).toEqual([]);
  });

  it("setEvalRunResult stores benchmark and notes", () => {
    const bench = makeBenchmark();
    const notes = ["Fix output format", "Add more examples"];
    useEvalRunStore.getState().setEvalRunResult(bench, notes);

    const state = useEvalRunStore.getState();
    expect(state.benchmark).toEqual(bench);
    expect(state.analystNotes).toEqual(notes);
  });

  it("clearEvalRunResult resets to initial state", () => {
    const bench = makeBenchmark();
    useEvalRunStore.getState().setEvalRunResult(bench, ["a note"]);
    useEvalRunStore.getState().clearEvalRunResult();

    const state = useEvalRunStore.getState();
    expect(state.benchmark).toBeNull();
    expect(state.analystNotes).toEqual([]);
  });

  it("setEvalRunResult overwrites previous result", () => {
    const bench1 = makeBenchmark();
    const bench2 = { ...makeBenchmark(), iteration: 2 };
    useEvalRunStore.getState().setEvalRunResult(bench1, ["note 1"]);
    useEvalRunStore.getState().setEvalRunResult(bench2, ["note 2"]);

    const state = useEvalRunStore.getState();
    expect(state.benchmark?.iteration).toBe(2);
    expect(state.analystNotes).toEqual(["note 2"]);
  });

  it("setEvalRunResult accepts empty notes array", () => {
    const bench = makeBenchmark();
    useEvalRunStore.getState().setEvalRunResult(bench, []);

    const state = useEvalRunStore.getState();
    expect(state.benchmark).not.toBeNull();
    expect(state.analystNotes).toEqual([]);
  });
});
