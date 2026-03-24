/**
 * eval-run-store.ts
 *
 * Holds only the cross-tab-navigation result of the most recent eval run.
 * Persists across Evals → Refine tab navigation so the Refine tab can
 * pre-fill its message input with failing assertions and analyst notes.
 *
 * Component-local state (selectedIds, runCount, isRunning, progress) must
 * NOT be stored here — keep those in useState inside WorkspaceEvals.
 */

import { create } from "zustand";
import type { EvalBenchmark } from "@/lib/types";

interface EvalRunState {
  /** The benchmark result from the most recent evaluate-skill run, or null if none. */
  benchmark: EvalBenchmark | null;
  /** Analyst observations from the analyzer subagent, or empty array if none. */
  analystNotes: string[];

  /** Save the completed benchmark + analyst notes (called on eval_complete event). */
  setEvalRunResult: (benchmark: EvalBenchmark, notes: string[]) => void;
  /** Clear the stored result (called when a new eval run starts). */
  clearEvalRunResult: () => void;
}

export const useEvalRunStore = create<EvalRunState>((set) => ({
  benchmark: null,
  analystNotes: [],

  setEvalRunResult: (benchmark, notes) => {
    set({ benchmark, analystNotes: notes });
  },

  clearEvalRunResult: () => {
    set({ benchmark: null, analystNotes: [] });
  },
}));
