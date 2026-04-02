/**
 * eval-run.ts — Data and Calculation layer for running evals.
 *
 * Pure functions only. No side effects, no React, no Tauri calls.
 * All Actions (IPC, state mutation, navigation) stay in the component layer.
 */

import type { EvalBenchmark } from "@/lib/types";

// --- Calculations ---

/**
 * Collect grading paths for evals that failed in any primary run.
 * Returns one entry per eval with all grading paths where failed > 0.
 * Only looks at primary `runs`, not `baseline_runs`.
 */
export function getFailedEvalGradingPaths(
  benchmark: EvalBenchmark,
): Array<{ eval_id: number; eval_name: string; grading_paths: string[] }> {
  const evalTotals: Record<number, { name: string; failingPaths: string[] }> = {};
  if (!Array.isArray(benchmark.runs)) return [];
  for (const run of benchmark.runs) {
    if (!Array.isArray(run.evals)) continue;
    for (const e of run.evals) {
      if (!evalTotals[e.eval_id]) {
        evalTotals[e.eval_id] = { name: e.eval_name, failingPaths: [] };
      }
      if (e.summary.failed > 0) {
        evalTotals[e.eval_id].failingPaths.push(e.grading_path);
      }
    }
  }

  const result: Array<{ eval_id: number; eval_name: string; grading_paths: string[] }> = [];
  for (const [idStr, v] of Object.entries(evalTotals)) {
    if (v.failingPaths.length > 0) {
      result.push({ eval_id: Number(idStr), eval_name: v.name, grading_paths: v.failingPaths });
    }
  }
  return result;
}

