import { useState, useRef, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2, Plus } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import {
  parseProgressEvent,
  addQuery,
  removeQuery,
  updateQuery,
  scoreColor,
} from "@/lib/description-optimization";
import type { EvalQuery, OptimizationIteration, OptimizationResult } from "@/lib/description-optimization";
import { startGenerateDescEvalQueries, runOptimizationLoop, applyDescription, saveEvalQueries, loadEvalQueries } from "@/lib/tauri";
import type { SkillSummary } from "@/lib/tauri";

interface WorkspaceDescriptionProps {
  skill: SkillSummary;
  workspacePath: string;
}

export function WorkspaceDescription({ skill, workspacePath }: WorkspaceDescriptionProps) {
  const preferredModel = useSettingsStore((s) => s.preferredModel);

  const [queries, setQueries] = useState<EvalQuery[]>([]);
  const [isGeneratingQueries, setIsGeneratingQueries] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<OptimizationIteration[]>([]);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const unlistenRef = useRef<(() => void) | null>(null);
  const generateUnlistenRef = useRef<(() => void) | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      unlistenRef.current?.();
      unlistenRef.current = null;
      generateUnlistenRef.current?.();
      generateUnlistenRef.current = null;
    };
  }, []);

  // Load persisted eval queries on mount / skill change
  useEffect(() => {
    if (!workspacePath) return;
    loadEvalQueries(skill.name, workspacePath)
      .then((loaded) => {
        if (loaded.length > 0) {
          setQueries(loaded.map((q) => ({ ...q, id: crypto.randomUUID() })));
        }
      })
      .catch((err) =>
        console.warn("[workspace-description] load queries failed:", err),
      );
  }, [skill.name, workspacePath]);

  // Auto-save queries (debounced)
  useEffect(() => {
    if (!workspacePath || queries.length === 0) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveEvalQueries(skill.name, workspacePath, queries).catch((err) =>
        console.warn("[workspace-description] save queries failed:", err),
      );
    }, 500);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [queries, skill.name, workspacePath]);

  const model = skill.model ?? preferredModel ?? "sonnet";

  async function handleGenerateQueries() {
    // Clean up any previous listener
    generateUnlistenRef.current?.();
    generateUnlistenRef.current = null;

    setIsGeneratingQueries(true);
    setGenerateError(null);

    // Set up listener before kicking off agent to avoid race
    const unlisten = await listen<{ skillName: string; queries: Array<{ query: string; should_trigger: boolean }> }>(
      "description:eval-queries-generated",
      (event) => {
        if (event.payload.skillName !== skill.name) return;
        const loaded = event.payload.queries;
        setQueries(loaded.map((q) => ({ ...q, id: crypto.randomUUID() })));
        setIsGeneratingQueries(false);
        generateUnlistenRef.current?.();
        generateUnlistenRef.current = null;
        console.log(
          "event=eval_queries_generated operation=startGenerateDescEvalQueries skill=%s count=%d status=success",
          skill.name,
          loaded.length,
        );
      },
    );
    generateUnlistenRef.current = unlisten;

    const agentId = crypto.randomUUID();
    const skillPath = `${workspacePath}/${skill.name}`;
    try {
      await startGenerateDescEvalQueries(agentId, skill.name, workspacePath, skillPath, model);
      console.log(
        "event=eval_queries_generation_started operation=startGenerateDescEvalQueries skill=%s status=started",
        skill.name,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setGenerateError(msg);
      setIsGeneratingQueries(false);
      generateUnlistenRef.current?.();
      generateUnlistenRef.current = null;
      console.error(
        "event=eval_queries_generation_failed operation=startGenerateDescEvalQueries skill=%s error=%s",
        skill.name,
        msg,
      );
    }
  }

  async function handleRunOptimization() {
    setResult(null);
    setProgress([]);
    setError(null);
    setApplied(false);
    setIsRunning(true);

    console.log(
      "event=optimization_start operation=runOptimizationLoop skill=%s model=%s query_count=%d",
      skill.name,
      model,
      queries.length,
    );

    try {
      const unlisten = await listen<unknown>("description:progress", (event) => {
        const iteration = parseProgressEvent(event.payload);
        if (iteration) {
          setProgress((prev) => [...prev, iteration]);
        }
      });
      unlistenRef.current = unlisten;

      const optimizationResult = await runOptimizationLoop(
        skill.name,
        workspacePath,
        model,
        queries,
      );

      setResult(optimizationResult);
      console.log(
        "event=optimization_complete operation=runOptimizationLoop skill=%s iterations=%d status=success",
        skill.name,
        optimizationResult.iterations_run,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      console.error(
        "event=optimization_failed operation=runOptimizationLoop skill=%s error=%s",
        skill.name,
        msg,
      );
    } finally {
      setIsRunning(false);
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    }
  }

  async function handleApply() {
    if (!result) return;
    setError(null);
    try {
      await applyDescription(skill.name, workspacePath, result.best_description);
      console.log(
        "event=description_applied operation=applyDescription skill=%s status=success",
        skill.name,
      );
      setResult(null);
      setApplied(true);
      setTimeout(() => setApplied(false), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      console.error(
        "event=description_apply_failed operation=applyDescription skill=%s error=%s",
        skill.name,
        msg,
      );
    }
  }

  const latestProgress = progress[progress.length - 1] ?? null;

  return (
    <div className="flex flex-col gap-4">
      {/* Section A: Eval Query Editor */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Trigger Eval Queries</h3>
            {queries.length > 0 && (
              <Badge variant="secondary" className="rounded-full">
                {queries.length}
              </Badge>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerateQueries}
            disabled={isGeneratingQueries || isRunning}
          >
            {isGeneratingQueries ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                Generating…
              </>
            ) : (
              "Generate"
            )}
          </Button>
        </div>

        {queries.length > 0 ? (
          <div className="space-y-2">
            {queries.map((q) => (
              <div key={q.id} className="flex items-center gap-2">
                <Input
                  value={q.query}
                  onChange={(e) =>
                    setQueries(updateQuery(queries, q.id, { query: e.target.value }))
                  }
                  placeholder="Enter query…"
                  className="flex-1 h-8 text-sm"
                  disabled={isRunning}
                />
                <Switch
                  checked={q.should_trigger}
                  onCheckedChange={() =>
                    setQueries(
                      updateQuery(queries, q.id, { should_trigger: !q.should_trigger }),
                    )
                  }
                  disabled={isRunning}
                  aria-label="Should trigger"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setQueries(removeQuery(queries, q.id))}
                  disabled={isRunning}
                  aria-label="Delete query"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground mb-2">
            No queries yet. Generate or add them manually.
          </p>
        )}

        <button
          type="button"
          className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors duration-150"
          onClick={() => setQueries(addQuery(queries))}
          disabled={isRunning}
        >
          <Plus className="h-3 w-3" />
          Add query
        </button>

        {generateError && (
          <p className="text-xs text-destructive mt-2">{generateError}</p>
        )}
      </div>

      {/* Section B: Optimization Runner */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Optimize Description</h3>
          <Button
            size="sm"
            onClick={handleRunOptimization}
            disabled={queries.length === 0 || queries.every(q => !q.should_trigger) || isRunning}
          >
            {isRunning ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                Running…
              </>
            ) : (
              "Optimize"
            )}
          </Button>
        </div>

        {isRunning && (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              Running… (iteration {progress.length})
            </p>
            {latestProgress && (
              <p className="text-sm">
                <span className="text-muted-foreground">Train: </span>
                <span className={scoreColor(latestProgress.train_passed, latestProgress.train_total)}>
                  {latestProgress.train_passed}/{latestProgress.train_total}
                </span>
                {latestProgress.test_passed !== null && latestProgress.test_total !== null && (
                  <>
                    <span className="text-muted-foreground mx-2">|</span>
                    <span className="text-muted-foreground">Test: </span>
                    <span className={scoreColor(latestProgress.test_passed, latestProgress.test_total)}>
                      {latestProgress.test_passed}/{latestProgress.test_total}
                    </span>
                  </>
                )}
              </p>
            )}
          </div>
        )}

        {queries.length > 0 && queries.every(q => !q.should_trigger) && (
          <p className="text-xs text-muted-foreground mt-2">Enable at least one query to run optimization.</p>
        )}

        {error && (
          <p className="text-sm text-destructive mt-2">{error}</p>
        )}
      </div>

      {applied && (
        <div className="rounded-lg border bg-card p-3 text-sm" style={{ color: "var(--color-seafoam)" }}>
          Description applied successfully.
        </div>
      )}

      {/* Section C: Optimization Results */}
      {result !== null && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Results</h3>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Before (Original)</p>
              <p className="text-sm">{result.original_description}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium" style={{ color: "var(--color-seafoam)" }}>
                After (Best)
              </p>
              <p className="text-sm">{result.best_description}</p>
            </div>
          </div>

          {result.history.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-muted-foreground mb-2">Score Progression</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th className="text-left pb-1 pr-3 font-medium">Iter</th>
                      <th className="text-left pb-1 pr-3 font-medium">Train</th>
                      <th className="text-left pb-1 font-medium">Test</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.history.map((iter) => (
                      <tr key={iter.iteration}>
                        <td className="pr-3 py-0.5 text-muted-foreground font-mono text-xs">
                          v{iter.iteration}
                        </td>
                        <td className={`pr-3 py-0.5 font-mono text-xs ${scoreColor(iter.train_passed, iter.train_total)}`}>
                          {iter.train_passed}/{iter.train_total}
                        </td>
                        <td className={`py-0.5 font-mono text-xs ${iter.test_passed !== null && iter.test_total !== null ? scoreColor(iter.test_passed, iter.test_total) : "text-muted-foreground"}`}>
                          {iter.test_passed !== null && iter.test_total !== null
                            ? `${iter.test_passed}/${iter.test_total}`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button size="sm" onClick={handleApply}>
              Apply best description
            </Button>
            <Button size="sm" variant="outline" onClick={() => setResult(null)}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
