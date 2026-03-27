/**
 * eval-run.ts — Data and Calculation layer for running evals.
 *
 * Pure functions only. No side effects, no React, no Tauri calls.
 * All Actions (IPC, state mutation, navigation) stay in the component layer.
 */

import type { EvalBenchmark, EvalCompleteEvent, EvalGradedEvent } from "@/lib/types";

// --- Calculations ---

/**
 * Build the prompt string passed to the evaluate-skill agent.
 * The agent parses this as structured key-value input.
 */
export function buildEvaluateSkillPrompt(params: {
  skillName: string;
  pluginSlug: string;
  workspacePath: string;
  skillsPath: string;
  evalIds: number[];
  runCount: 1 | 3;
  comparisonMode?: "with_without_skill" | "current_vs_previous";
  iteration: number;
  iterDir: string;
}): string {
  const { skillName, pluginSlug, workspacePath, skillsPath, evalIds, runCount, comparisonMode, iteration, iterDir } = params;
  const skillPath = `${skillsPath}/${skillName}`;
  const lines = [
    `skill_name: ${skillName}`,
    `plugin_slug: ${pluginSlug}`,
    `workspace_path: ${workspacePath}`,
    `eval_ids: ${JSON.stringify(evalIds)}`,
    `run_count: ${runCount}`,
    `skill_path: ${skillPath}`,
    `iteration: ${iteration}`,
    `iter_dir: ${iterDir}`,
  ];
  if (comparisonMode) {
    lines.push(`comparison_mode: ${comparisonMode}`);
  }
  return lines.join("\n");
}

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

/**
 * Parse a raw structuredOutput value from a DisplayItem into a typed eval event.
 * Returns null if the value is not a recognised eval event.
 */
export function parseEvalStructuredOutput(
  output: unknown,
): EvalGradedEvent | EvalCompleteEvent | null {
  if (output === null || typeof output !== "object") return null;
  const obj = output as Record<string, unknown>;
  if (obj.type === "eval_graded") return obj as unknown as EvalGradedEvent;
  if (obj.type === "complete") return obj as unknown as EvalCompleteEvent;
  return null;
}

/**
 * Compute progress as a 0-100 percentage.
 * gradedCount is the number of (run × eval) pairs completed so far.
 * total = totalEvals * totalRuns.
 */
export function evalProgressPercent(
  gradedCount: number,
  totalEvals: number,
  totalRuns: number,
): number {
  const total = totalEvals * totalRuns;
  if (total === 0) return 0;
  return Math.round((gradedCount / total) * 100);
}
