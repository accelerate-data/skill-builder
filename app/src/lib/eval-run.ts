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
  workspacePath: string;
  evalIds: number[];
  runCount: 1 | 3;
}): string {
  const { skillName, workspacePath, evalIds, runCount } = params;
  const skillPath = `${workspacePath}/${skillName}`;
  return [
    `skill_name: ${skillName}`,
    `workspace_path: ${workspacePath}`,
    `eval_ids: ${JSON.stringify(evalIds)}`,
    `run_count: ${runCount}`,
    `skill_path: ${skillPath}`,
  ].join("\n");
}

/**
 * Build the pre-fill message for the Refine tab from benchmark failures and analyst notes.
 * Summarises failing evals (name, avg pass rate) and appends analyst observations.
 */
export function buildRefinePrefill(
  benchmark: EvalBenchmark,
  analystNotes: string[],
): string {
  const { aggregate_summary, runs, iteration } = benchmark;

  // Collect per-eval average pass rates across runs
  const evalTotals: Record<number, { name: string; passRateSum: number; runCount: number }> = {};
  for (const run of runs) {
    for (const e of run.evals) {
      if (!evalTotals[e.eval_id]) {
        evalTotals[e.eval_id] = { name: e.eval_name, passRateSum: 0, runCount: 0 };
      }
      evalTotals[e.eval_id].passRateSum += e.summary.pass_rate;
      evalTotals[e.eval_id].runCount += 1;
    }
  }

  const failingLines: string[] = [];
  for (const [, v] of Object.entries(evalTotals)) {
    const avgRate = v.runCount > 0 ? v.passRateSum / v.runCount : 0;
    if (avgRate < 1.0) {
      const pct = Math.round(avgRate * 100);
      failingLines.push(`- **${v.name}** — avg pass rate ${pct}%`);
    }
  }

  const parts: string[] = [];

  parts.push(
    `The following eval assertions failed in iteration-${iteration} (${benchmark.run_count} run${benchmark.run_count > 1 ? "s" : ""}):`,
    "",
    ...failingLines,
    "",
    `Total: ${aggregate_summary.total_failed} failed / ${aggregate_summary.total_assertions} assertions`,
  );

  if (analystNotes.length > 0) {
    parts.push("", "Analyst notes:");
    for (const note of analystNotes) {
      parts.push(`- ${note}`);
    }
  }

  parts.push("", "Please update the skill to address these gaps.");

  return parts.join("\n");
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
