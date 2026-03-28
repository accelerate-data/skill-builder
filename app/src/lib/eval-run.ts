/**
 * eval-run.ts — Data and Calculation layer for running evals.
 *
 * Pure functions only. No side effects, no React, no Tauri calls.
 * All Actions (IPC, state mutation, navigation) stay in the component layer.
 */

import type { EvalBenchmark } from "@/lib/types";

// --- Calculations ---

/**
 * Collect grading paths for evals that have avg pass_rate < 1.0 across primary runs.
 * Only looks at primary `runs`, not `baseline_runs`.
 */
export function getFailedEvalGradingPaths(
  benchmark: EvalBenchmark,
): Array<{ eval_id: number; eval_name: string; grading_path: string }> {
  const evalTotals: Record<number, { name: string; passRateSum: number; runCount: number; gradingPath: string }> = {};
  if (!Array.isArray(benchmark.runs)) return [];
  for (const run of benchmark.runs) {
    if (!Array.isArray(run.evals)) continue;
    for (const e of run.evals) {
      if (!evalTotals[e.eval_id]) {
        evalTotals[e.eval_id] = { name: e.eval_name, passRateSum: 0, runCount: 0, gradingPath: e.grading_path };
      }
      evalTotals[e.eval_id].passRateSum += e.summary.pass_rate;
      evalTotals[e.eval_id].runCount += 1;
    }
  }

  const result: Array<{ eval_id: number; eval_name: string; grading_path: string }> = [];
  for (const [idStr, v] of Object.entries(evalTotals)) {
    const avgRate = v.runCount > 0 ? v.passRateSum / v.runCount : 0;
    if (avgRate < 1.0) {
      result.push({ eval_id: Number(idStr), eval_name: v.name, grading_path: v.gradingPath });
    }
  }
  return result;
}

