import { useState, useEffect } from "react";
import { readFile, resetWorkflowStep } from "@/lib/tauri";
import { joinPath } from "@/lib/path-utils";
import type { BenchmarkData } from "@/components/benchmark-summary-card";

/**
 * Load benchmark metadata and data for step 3 (Generate Skill).
 * Auto-cleans up step 3 files when benchmark is truly missing (not skipped).
 */
export function useBenchmarkData(
  stepId: number | undefined,
  workspacePath: string | undefined,
  skillName: string | undefined,
  reviewMode?: boolean,
) {
  const [benchmarkData, setBenchmarkData] = useState<BenchmarkData | null>(null);
  const [benchmarkLoaded, setBenchmarkLoaded] = useState(false);
  /** "skipped" = agent reported no evals (stub); "missing" = expected but not found; "partial" = incomplete run, no auto-cleanup; false = ok */
  const [benchmarkStatus, setBenchmarkStatus] = useState<"skipped" | "partial" | "missing" | false>(false);

  useEffect(() => {
    if (stepId !== 3 || !workspacePath || !skillName) {
      setBenchmarkData(null);
      setBenchmarkLoaded(false);
      setBenchmarkStatus(false);
      return;
    }

    let cancelled = false;

    (async () => {
      const metaPath = joinPath(workspacePath, skillName, "context", "benchmark-meta.json");
      let agentStatus: string | null = null;
      let benchmarkPath: string | null = null;
      try {
        const metaContent = await readFile(metaPath);
        const meta = JSON.parse(metaContent);
        agentStatus = meta.benchmark_status ?? null;
        benchmarkPath = meta.benchmark_path ?? null;
      } catch {
        // No meta file — older run or materializer didn't write it
      }

      if (cancelled) return;

      if (agentStatus === "skipped") {
        setBenchmarkData(null);
        setBenchmarkStatus("skipped");
        setBenchmarkLoaded(true);
        return;
      }

      const jsonPath = benchmarkPath
        ? joinPath(workspacePath, skillName, benchmarkPath, "benchmark.json")
        : joinPath(workspacePath, skillName, "evals", "workspace", "iteration-1", "benchmark.json");
      try {
        const content = await readFile(jsonPath);
        if (cancelled) return;
        setBenchmarkData(JSON.parse(content) as BenchmarkData);
        setBenchmarkStatus(false);
      } catch {
        if (cancelled) return;
        if (agentStatus === "partial") {
          // Agent explicitly said partial — benchmark may still be in flight or incomplete.
          // Don't auto-cleanup; surface as a recoverable partial state.
          console.warn("[step-complete] benchmark.json not found but agent reported partial — no cleanup");
          setBenchmarkData(null);
          setBenchmarkStatus("partial");
        } else {
          console.warn("[step-complete] benchmark.json not found — missing");
          setBenchmarkData(null);
          setBenchmarkStatus("missing");
        }
      }
      setBenchmarkLoaded(true);
    })();

    return () => { cancelled = true; };
  }, [stepId, workspacePath, skillName]);

  // Auto-cleanup step 3 files when benchmark is truly missing (not skipped or partial)
  useEffect(() => {
    if (benchmarkStatus !== "missing" || stepId !== 3 || !workspacePath || !skillName || reviewMode) return;
    console.log("[step-complete] benchmark missing — cleaning up step 3 files");
    resetWorkflowStep(workspacePath, skillName, 3).catch((err) =>
      console.error("[step-complete] Failed to clean up step 3 files:", err),
    );
  }, [benchmarkStatus, stepId, workspacePath, skillName, reviewMode]);

  return { benchmarkData, benchmarkLoaded, benchmarkStatus };
}
