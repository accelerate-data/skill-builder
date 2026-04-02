import "@/hooks/use-agent-stream";
import { useState, useRef, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { AgentOutputPanel } from "@/components/agent-output-panel";
import { useAgentStore } from "@/stores/agent-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  parseProgressEvent,
  addQuery,
  removeQuery,
  updateQuery,
  scoreColor,
} from "@/lib/description-optimization";
import type { EvalQuery, OptimizationIteration, OptimizationResult } from "@/lib/description-optimization";
import { startGenerateDescEvalQueries, runOptimizationLoop, applyDescription, saveEvalQueries, loadEvalQueries, cancelAgentRun, cancelDescriptionOptimization } from "@/lib/tauri";
import type { SkillSummary } from "@/lib/tauri";

interface WorkspaceDescriptionProps {
  skill: SkillSummary;
  workspacePath: string;
  onRunningChange?: (running: boolean) => void;
}

export function WorkspaceDescription({ skill, workspacePath, onRunningChange }: WorkspaceDescriptionProps) {
  const preferredModel = useSettingsStore((s) => s.preferredModel);

  const [queries, setQueries] = useState<EvalQuery[]>([]);
  const [isGeneratingQueries, setIsGeneratingQueries] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<OptimizationIteration[]>([]);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [numEvalQueriesInput, setNumEvalQueriesInput] = useState("20");
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const agentHasRun = useAgentStore((s) => activeAgentId ? activeAgentId in s.runs : false);

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

  // ESC → cancel confirmation guard (capture phase, fires before Dialog's own handler)
  useEffect(() => {
    if (!isGeneratingQueries) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setShowCancelConfirm(true);
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [isGeneratingQueries]);

  // Load persisted eval queries on mount / skill change
  useEffect(() => {
    if (!workspacePath) return;
    loadEvalQueries(skill.name, skill.plugin_slug, workspacePath)
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
      saveEvalQueries(skill.name, skill.plugin_slug, workspacePath, queries).catch((err) =>
        console.warn("[workspace-description] save queries failed:", err),
      );
    }, 500);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [queries, skill.name, workspacePath]);

  // Notify parent when running state changes
  useEffect(() => {
    onRunningChange?.(isRunning);
  }, [isRunning, onRunningChange]);

  const model = skill.model ?? preferredModel ?? "sonnet";

  async function handleGenerateQueries(numEvalQueries: number) {
    // Clean up any previous listener
    generateUnlistenRef.current?.();
    generateUnlistenRef.current = null;

    setIsGeneratingQueries(true);
    setGenerateError(null);

    // Set up result listener before kicking off agent to avoid race
    const unlisten = await listen<{ skillName: string; queries: Array<{ query: string; should_trigger: boolean }> }>(
      "description:eval-queries-generated",
      (event) => {
        if (event.payload.skillName !== skill.name) return;
        const loaded = event.payload.queries;
        setQueries(loaded.map((q) => ({ ...q, id: crypto.randomUUID() })));
        setIsGeneratingQueries(false);
        setActiveAgentId(null);
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
    setActiveAgentId(agentId);

    // Register the run before starting the agent so the agent store has the
    // correct model. Without this, the phantom reaper marks auto-created runs
    // as "error" after 30s because model stays "unknown".
    useAgentStore.getState().registerRun(agentId, model, skill.name);

    try {
      await startGenerateDescEvalQueries(agentId, skill.name, skill.plugin_slug, workspacePath, model, numEvalQueries);
      console.log(
        "event=eval_queries_generation_started operation=startGenerateDescEvalQueries skill=%s status=started",
        skill.name,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setGenerateError(msg);
      setIsGeneratingQueries(false);
      setActiveAgentId(null);
      generateUnlistenRef.current?.();
      generateUnlistenRef.current = null;
      console.error(
        "event=eval_queries_generation_failed operation=startGenerateDescEvalQueries skill=%s error=%s",
        skill.name,
        msg,
      );
    }
  }

  async function handleCancelGenerate() {
    setShowCancelConfirm(false);
    if (activeAgentId) {
      await cancelAgentRun(skill.name, activeAgentId).catch(() => {});
    }
    generateUnlistenRef.current?.();
    generateUnlistenRef.current = null;
    setActiveAgentId(null);
    setIsGeneratingQueries(false);
    console.log(
      "event=eval_queries_generation_cancelled operation=handleCancelGenerate skill=%s",
      skill.name,
    );
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
      // Don't show "cancelled" as an error — it's user-initiated
      if (!msg.toLowerCase().includes("cancelled")) {
        setError(msg);
        console.error(
          "event=optimization_failed operation=runOptimizationLoop skill=%s error=%s",
          skill.name,
          msg,
        );
      }
    } finally {
      setIsRunning(false);
      setIsCancelling(false);
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    }
  }

  async function handleCancel() {
    setIsCancelling(true);
    try {
      await cancelDescriptionOptimization();
      console.log(
        "event=optimization_cancelled operation=cancelDescriptionOptimization skill=%s",
        skill.name,
      );
    } catch (err) {
      console.warn("[workspace-description] cancel failed:", err);
    }
  }

  async function handleApply() {
    if (!result) return;
    setError(null);
    try {
      await applyDescription(skill.name, skill.plugin_slug, workspacePath, result.best_description);
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
            onClick={() => { setNumEvalQueriesInput("20"); setShowGenerateDialog(true); }}
            disabled={isGeneratingQueries || isRunning}
          >
            Generate
          </Button>
        </div>

        {queries.length === 0 && (
          <p className="text-sm text-muted-foreground mb-2">
            No queries yet. Generate or add them manually.
          </p>
        )}

        <div className="grid grid-cols-2 gap-4">
          {/* Left column: should trigger */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold tracking-tight" style={{ color: "var(--color-pacific)" }}>Should Trigger</p>
            {queries.filter((q) => q.should_trigger).map((q) => (
              <div key={q.id} className="flex items-start gap-1.5">
                <Textarea
                  value={q.query}
                  onChange={(e) =>
                    setQueries(updateQuery(queries, q.id, { query: e.target.value }))
                  }
                  placeholder="Enter query…"
                  className="flex-1 min-h-[52px] resize-none text-sm py-1.5 leading-snug"
                  disabled={isRunning}
                />
                <Switch
                  checked={q.should_trigger}
                  onCheckedChange={() =>
                    setQueries(updateQuery(queries, q.id, { should_trigger: !q.should_trigger }))
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
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors duration-150"
              onClick={() => setQueries(addQuery(queries, true))}
              disabled={isRunning}
            >
              <Plus className="h-3 w-3" />
              Add query
            </button>
          </div>

          {/* Right column: should not trigger */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium tracking-tight text-muted-foreground">Should Not Trigger</p>
            {queries.filter((q) => !q.should_trigger).map((q) => (
              <div key={q.id} className="flex items-start gap-1.5">
                <Textarea
                  value={q.query}
                  onChange={(e) =>
                    setQueries(updateQuery(queries, q.id, { query: e.target.value }))
                  }
                  placeholder="Enter query…"
                  className="flex-1 min-h-[52px] resize-none text-sm py-1.5 leading-snug"
                  disabled={isRunning}
                />
                <Switch
                  checked={q.should_trigger}
                  onCheckedChange={() =>
                    setQueries(updateQuery(queries, q.id, { should_trigger: !q.should_trigger }))
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
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors duration-150"
              onClick={() => setQueries(addQuery(queries, false))}
              disabled={isRunning}
            >
              <Plus className="h-3 w-3" />
              Add query
            </button>
          </div>
        </div>

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
            disabled
            title="Coming soon"
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
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground">
                Running… (iteration {progress.length})
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCancel}
                disabled={isCancelling}
              >
                {isCancelling ? (
                  <>
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    Cancelling…
                  </>
                ) : (
                  "Cancel"
                )}
              </Button>
            </div>
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

      {/* Number of queries dialog */}
      <Dialog open={showGenerateDialog} onOpenChange={(open) => { if (!open) setShowGenerateDialog(false); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Generate Eval Queries</DialogTitle>
            <DialogDescription>
              How many trigger eval queries should be generated? Minimum 10, recommended 20.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="num-eval-queries">Number of queries</Label>
            <Input
              id="num-eval-queries"
              type="number"
              autoFocus
              value={numEvalQueriesInput}
              onChange={(e) => setNumEvalQueriesInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const n = parseInt(numEvalQueriesInput, 10);
                  if (!isNaN(n) && n >= 10) {
                    setShowGenerateDialog(false);
                    void handleGenerateQueries(n);
                  }
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGenerateDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const n = parseInt(numEvalQueriesInput, 10);
                if (!isNaN(n) && n >= 10) {
                  setShowGenerateDialog(false);
                  void handleGenerateQueries(n);
                }
              }}
              disabled={(() => { const n = parseInt(numEvalQueriesInput, 10); return isNaN(n) || n < 10; })()}
            >
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fullscreen blocking overlay while generating */}
      <Dialog open={isGeneratingQueries}>
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-4xl w-full"
          onInteractOutside={() => setShowCancelConfirm(true)}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--color-pacific)" }} />
              Generating Eval Queries
            </DialogTitle>
            <DialogDescription>
              Claude is generating eval queries for <strong>{skill.name}</strong>.
              Click outside or press <kbd className="rounded border px-1 text-xs">ESC</kbd> to cancel.
            </DialogDescription>
          </DialogHeader>
          <div className="h-[420px] flex flex-col min-h-0 overflow-hidden">
            {agentHasRun && activeAgentId ? (
              <AgentOutputPanel agentId={activeAgentId} />
            ) : (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--color-pacific)" }} />
                <span>Starting agent…</span>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel confirmation guard */}
      <AlertDialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop generating?</AlertDialogTitle>
            <AlertDialogDescription>
              The eval query generation will be cancelled. No queries will be saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue generating</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleCancelGenerate()}>
              Stop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
