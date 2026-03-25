import { useState, useRef, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Zap,
  RefreshCw,
  Check,
  X,
  ArrowRight,
  CheckCircle2,
  Square,
  ClipboardList,
  Plus,
  Trash2,
  Loader2,
} from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import {
  parseProgressEvent,
  addQuery,
  removeQuery,
  updateQuery,
  scoreColor,
  computeDiff,
  getBestIteration,
} from "@/lib/description-optimization";
import type {
  EvalQuery,
  OptimizationIteration,
  OptimizationResult,
} from "@/lib/description-optimization";
import {
  generateEvalQueries,
  runOptimizationLoop,
  applyDescription,
} from "@/lib/tauri";
import type { SkillSummary } from "@/lib/tauri";

interface WorkspaceDescriptionProps {
  skill: SkillSummary;
  workspacePath: string;
}

// ─── Step indicator ────────────────────────────────────────────────────────────

interface StepIndicatorProps {
  currentStep: 1 | 2 | 3;
  hasResult: boolean;
}

function StepIndicator({ currentStep, hasResult }: StepIndicatorProps) {
  const steps: { label: string }[] = [
    { label: "Trigger Eval Queries" },
    { label: "Optimization Loop" },
    { label: "Apply Result" },
  ];

  function isDone(step: number): boolean {
    return step < currentStep || (step === 3 && hasResult);
  }

  function isActive(step: number): boolean {
    return step === currentStep;
  }

  return (
    <div className="flex items-start gap-0 mb-6">
      {steps.map((s, idx) => {
        const step = idx + 1;
        const done = isDone(step);
        const active = isActive(step);
        const isLast = idx === steps.length - 1;

        return (
          <div key={step} className="flex items-start flex-1 min-w-0">
            {/* Circle + label */}
            <div className="flex flex-col items-center shrink-0">
              <div
                className="flex items-center justify-center rounded-full"
                style={{
                  width: 22,
                  height: 22,
                  background: done
                    ? "var(--color-seafoam)"
                    : active
                      ? "var(--color-pacific)"
                      : undefined,
                  border:
                    done || active ? undefined : "1.5px solid hsl(var(--muted-foreground) / 0.4)",
                  color: done || active ? "white" : undefined,
                }}
              >
                {done ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <span
                    className="text-[10px] font-semibold leading-none"
                    style={{ color: active ? "white" : "hsl(var(--muted-foreground))" }}
                  >
                    {step}
                  </span>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground mt-1 text-center leading-tight max-w-[70px]">
                {s.label}
              </span>
            </div>

            {/* Connector line (between circles) */}
            {!isLast && (
              <div
                className="flex-1 mx-1 mt-[10px] shrink"
                style={{ height: 1.5, minWidth: 8 }}
              >
                <div
                  className="w-full h-full"
                  style={{
                    background: isDone(step)
                      ? "var(--color-seafoam)"
                      : "hsl(var(--muted-foreground) / 0.25)",
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function WorkspaceDescription({ skill, workspacePath }: WorkspaceDescriptionProps) {
  const preferredModel = useSettingsStore((s) => s.preferredModel);

  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [isCancelling, setIsCancelling] = useState(false);

  const [queries, setQueries] = useState<EvalQuery[]>([]);
  const [isGeneratingQueries, setIsGeneratingQueries] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<OptimizationIteration[]>([]);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, []);

  const model = skill.model ?? preferredModel ?? "sonnet";

  async function handleGenerateQueries() {
    setIsGeneratingQueries(true);
    setGenerateError(null);
    try {
      const generated = await generateEvalQueries(skill.name, workspacePath, model);
      setQueries(generated);
      console.log(
        "event=eval_queries_generated operation=generateEvalQueries skill=%s count=%d status=success",
        skill.name,
        generated.length,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setGenerateError(msg);
      console.error(
        "event=eval_queries_generation_failed operation=generateEvalQueries skill=%s error=%s",
        skill.name,
        msg,
      );
    } finally {
      setIsGeneratingQueries(false);
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

      // Soft-cancel check: if user cancelled during the loop, go back to step 1
      if (isCancelling) {
        setIsCancelling(false);
        setCurrentStep(1);
        setProgress([]);
        return;
      }

      setCurrentStep(3);
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

  function handleProceed() {
    setCurrentStep(2);
    void handleRunOptimization();
  }

  const canProceed = queries.length > 0 && queries.some((q) => q.should_trigger);
  const latestProgress = progress[progress.length - 1] ?? null;

  const shouldTriggerQueries = queries.filter((q) => q.should_trigger);
  const shouldNotTriggerQueries = queries.filter((q) => !q.should_trigger);

  // Derive bestSoFar for step 2: max test score seen so far
  const bestSoFar: number | null = progress.reduce<number | null>((best, iter) => {
    if (iter.test_passed !== null && iter.test_total !== null && iter.test_total > 0) {
      const score = iter.test_passed / iter.test_total;
      return best === null || score > best ? score : best;
    }
    return best;
  }, null);

  return (
    <div className="flex flex-col gap-4">
      <StepIndicator currentStep={currentStep} hasResult={result !== null} />

      {/* Applied toast */}
      {applied && (
        <div
          className="rounded-md border px-3 py-2 text-sm"
          style={{ color: "var(--color-seafoam)" }}
        >
          Description applied successfully.
        </div>
      )}

      {/* ── Step 1 ── */}
      {currentStep === 1 && (
        <div className="space-y-3">
          {/* Current description card */}
          <div className="rounded-md bg-muted px-3 py-2 mb-4">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
              Current Description
            </p>
            <p className="text-sm">{skill.description ?? "No description set."}</p>
          </div>

          {/* Generate / Regenerate button */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Trigger Eval Queries</h3>
            <Button
              variant={queries.length > 0 ? "outline" : "default"}
              size="sm"
              onClick={handleGenerateQueries}
              disabled={isGeneratingQueries || isRunning}
            >
              {isGeneratingQueries ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  Generating…
                </>
              ) : queries.length > 0 ? (
                <>
                  <RefreshCw className="mr-1 h-3 w-3" />
                  Regenerate
                </>
              ) : (
                <>
                  <Zap className="mr-1 h-3 w-3" />
                  Generate 20 queries
                </>
              )}
            </Button>
          </div>

          {/* Query list */}
          {queries.length > 0 ? (
            <div className="grid grid-cols-2 gap-4">
              {/* Left: should_trigger === true */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded-full"
                    style={{
                      background:
                        "color-mix(in oklch, var(--color-seafoam), transparent 85%)",
                      color: "var(--color-seafoam)",
                    }}
                  >
                    Should trigger
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {shouldTriggerQueries.length} queries
                  </span>
                </div>
                {shouldTriggerQueries.map((q) => (
                  <QueryRow
                    key={q.id}
                    q={q}
                    queries={queries}
                    setQueries={setQueries}
                    isRunning={isRunning}
                  />
                ))}
              </div>

              {/* Right: should_trigger === false */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    Should not trigger
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {shouldNotTriggerQueries.length} queries
                  </span>
                </div>
                {shouldNotTriggerQueries.map((q) => (
                  <QueryRow
                    key={q.id}
                    q={q}
                    queries={queries}
                    setQueries={setQueries}
                    isRunning={isRunning}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
              <ClipboardList className="h-8 w-8 opacity-40" />
              <p className="text-sm">
                No queries generated yet — click <strong>Generate</strong> to create eval
                queries.
              </p>
            </div>
          )}

          {/* Footer row */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t">
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setQueries(addQuery(queries))}
              disabled={isRunning}
            >
              <Plus className="h-3 w-3" /> Add query
            </button>
            <Button size="sm" onClick={handleProceed} disabled={!canProceed}>
              Proceed to Optimize <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>

          {generateError && (
            <p className="text-xs text-destructive mt-2">{generateError}</p>
          )}
        </div>
      )}

      {/* ── Step 2 ── */}
      {currentStep === 2 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Step 2: Optimization Loop</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Running up to 5 iterations · 60/40 train/test split · 3× runs per query
            </p>
          </div>

          {/* Progress bar */}
          <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${(progress.length / 5) * 100}%`,
                background: "linear-gradient(90deg, var(--color-pacific), var(--color-seafoam))",
              }}
            />
          </div>

          {/* Score cards */}
          {latestProgress && (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md bg-muted p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Train score
                </p>
                <p
                  className={`text-lg font-semibold font-mono ${scoreColor(latestProgress.train_passed, latestProgress.train_total)}`}
                >
                  {(latestProgress.train_passed / latestProgress.train_total).toFixed(2)}
                </p>
              </div>
              <div className="rounded-md bg-muted p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Test score
                </p>
                <p
                  className={`text-lg font-semibold font-mono ${
                    latestProgress.test_passed !== null && latestProgress.test_total !== null
                      ? scoreColor(latestProgress.test_passed, latestProgress.test_total)
                      : "text-muted-foreground"
                  }`}
                >
                  {latestProgress.test_passed !== null && latestProgress.test_total !== null
                    ? (latestProgress.test_passed / latestProgress.test_total).toFixed(2)
                    : "—"}
                </p>
              </div>
              <div className="rounded-md bg-muted p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Best so far
                </p>
                <p className="text-lg font-semibold font-mono text-muted-foreground">
                  {bestSoFar !== null ? bestSoFar.toFixed(2) : "—"}
                </p>
              </div>
            </div>
          )}

          {/* Completed iterations table */}
          {progress.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
                Completed Iterations
              </p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left pb-1 pr-3 font-medium">Iteration</th>
                    <th className="text-left pb-1 pr-3 font-medium">Train</th>
                    <th className="text-left pb-1 pr-3 font-medium">Test</th>
                    <th className="text-left pb-1 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {progress.map((iter, i) => (
                    <tr key={iter.iteration}>
                      <td className="pr-3 py-0.5 font-mono">{iter.iteration}</td>
                      <td
                        className={`pr-3 py-0.5 font-mono ${scoreColor(iter.train_passed, iter.train_total)}`}
                      >
                        {(iter.train_passed / iter.train_total).toFixed(2)}
                      </td>
                      <td
                        className={`pr-3 py-0.5 font-mono ${
                          iter.test_passed !== null && iter.test_total !== null
                            ? scoreColor(iter.test_passed, iter.test_total)
                            : "text-muted-foreground"
                        }`}
                      >
                        {iter.test_passed !== null && iter.test_total !== null
                          ? (iter.test_passed / iter.test_total).toFixed(2)
                          : "—"}
                      </td>
                      <td className="py-0.5">
                        {i === progress.length - 1 ? (
                          <Loader2
                            className="h-3 w-3 animate-spin"
                            style={{ color: "var(--color-pacific)" }}
                          />
                        ) : (
                          <span className="text-muted-foreground">done</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Cancel */}
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              className="text-destructive border-destructive hover:bg-destructive/10"
              onClick={() => setIsCancelling(true)}
              disabled={isCancelling}
            >
              <Square className="mr-1.5 h-3 w-3" />
              {isCancelling ? "Cancelling…" : "Cancel"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3 ── */}
      {currentStep === 3 && result !== null && (
        <Step3Result
          result={result}
          onApply={handleApply}
          onDiscard={() => {
            setResult(null);
            setCurrentStep(1);
          }}
          onRunAgain={() => {
            setResult(null);
            setCurrentStep(1);
          }}
          error={error}
        />
      )}
    </div>
  );
}

// ─── QueryRow helper ───────────────────────────────────────────────────────────

interface QueryRowProps {
  q: EvalQuery;
  queries: EvalQuery[];
  setQueries: (queries: EvalQuery[]) => void;
  isRunning: boolean;
}

function QueryRow({ q, queries, setQueries, isRunning }: QueryRowProps) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      {q.should_trigger ? (
        <Check className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-seafoam)" }} />
      ) : (
        <X className="h-3.5 w-3.5 shrink-0 text-destructive" />
      )}
      <Input
        value={q.query}
        onChange={(e) => setQueries(updateQuery(queries, q.id, { query: e.target.value }))}
        className="flex-1 h-7 text-xs"
        disabled={isRunning}
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={() => setQueries(removeQuery(queries, q.id))}
        disabled={isRunning}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
      <Switch
        checked={q.should_trigger}
        onCheckedChange={() =>
          setQueries(updateQuery(queries, q.id, { should_trigger: !q.should_trigger }))
        }
        disabled={isRunning}
      />
    </div>
  );
}

// ─── Step3Result helper ────────────────────────────────────────────────────────

interface Step3ResultProps {
  result: OptimizationResult;
  onApply: () => void;
  onDiscard: () => void;
  onRunAgain: () => void;
  error: string | null;
}

function Step3Result({ result, onApply, onDiscard, onRunAgain, error }: Step3ResultProps) {
  const bestIdx = getBestIteration(result.history);
  const bestIter = result.history[bestIdx];
  const bestTestScore =
    bestIter.test_passed !== null && bestIter.test_total !== null
      ? (bestIter.test_passed / bestIter.test_total).toFixed(2)
      : null;

  const bestDisplayScore =
    bestTestScore ??
    (bestIter.train_total > 0
      ? (bestIter.train_passed / bestIter.train_total).toFixed(2)
      : "—");

  const diffParts = computeDiff(result.original_description, result.best_description);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Step 3: Apply Result</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {result.iterations_run} iterations complete · best test score{" "}
          <span style={{ color: "var(--color-seafoam)" }}>{bestDisplayScore}</span> at
          iteration {bestIter.iteration}
        </p>
      </div>

      {/* Iterations table with Delta + best row highlight */}
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
          Score History
        </p>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-muted text-muted-foreground">
              <th className="text-left px-2 py-1 font-medium">Iteration</th>
              <th className="text-left px-2 py-1 font-medium">Train</th>
              <th className="text-left px-2 py-1 font-medium">Test</th>
              <th className="text-left px-2 py-1 font-medium">Delta</th>
            </tr>
          </thead>
          <tbody>
            {result.history.map((iter, i) => {
              const isBest = i === bestIdx;
              const prevIter = i > 0 ? result.history[i - 1] : null;
              const testScore =
                iter.test_passed !== null && iter.test_total !== null
                  ? iter.test_passed / iter.test_total
                  : null;
              const prevTestScore =
                prevIter !== null &&
                prevIter.test_passed !== null &&
                prevIter.test_total !== null
                  ? prevIter.test_passed / prevIter.test_total
                  : null;
              const delta =
                testScore !== null && prevTestScore !== null ? testScore - prevTestScore : null;

              return (
                <tr
                  key={iter.iteration}
                  style={
                    isBest
                      ? {
                          background:
                            "color-mix(in oklch, var(--color-seafoam), transparent 90%)",
                        }
                      : undefined
                  }
                >
                  <td className="px-2 py-1 font-mono">
                    {iter.iteration}
                    {isBest && (
                      <span
                        className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full uppercase"
                        style={{
                          background:
                            "color-mix(in oklch, var(--color-seafoam), transparent 80%)",
                          color: "var(--color-seafoam)",
                        }}
                      >
                        best
                      </span>
                    )}
                  </td>
                  <td
                    className={`px-2 py-1 font-mono ${isBest ? "font-semibold" : ""} ${scoreColor(iter.train_passed, iter.train_total)}`}
                  >
                    {(iter.train_passed / iter.train_total).toFixed(2)}
                  </td>
                  <td
                    className={`px-2 py-1 font-mono ${isBest ? "font-semibold" : ""} ${
                      testScore !== null
                        ? scoreColor(iter.test_passed!, iter.test_total!)
                        : "text-muted-foreground"
                    }`}
                  >
                    {testScore !== null ? testScore.toFixed(2) : "—"}
                  </td>
                  <td
                    className={`px-2 py-1 font-mono ${
                      delta === null
                        ? "text-muted-foreground"
                        : delta >= 0
                          ? "text-[var(--color-seafoam)]"
                          : "text-destructive"
                    }`}
                  >
                    {delta === null
                      ? "—"
                      : delta >= 0
                        ? `+${delta.toFixed(2)}`
                        : delta.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Description diff */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Description Diff — Iteration 1 vs Best (Iteration {bestIter.iteration})
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-1.5 mb-2 text-destructive">
              <X className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">Before (iteration 1)</span>
            </div>
            <p className="text-xs leading-relaxed">
              {diffParts
                .filter((p) => p.type !== "inserted")
                .map((part, i) =>
                  part.type === "deleted" ? (
                    <span
                      key={i}
                      className="bg-destructive/15 text-destructive line-through rounded px-0.5"
                    >
                      {part.text}
                    </span>
                  ) : (
                    <span key={i}>{part.text}</span>
                  ),
                )}
            </p>
          </div>
          <div className="rounded-md border p-3">
            <div
              className="flex items-center gap-1.5 mb-2"
              style={{ color: "var(--color-seafoam)" }}
            >
              <Check className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">
                After (iteration {bestIter.iteration} · best)
              </span>
            </div>
            <p className="text-xs leading-relaxed">
              {diffParts
                .filter((p) => p.type !== "deleted")
                .map((part, i) =>
                  part.type === "inserted" ? (
                    <span
                      key={i}
                      className="rounded px-0.5"
                      style={{
                        background:
                          "color-mix(in oklch, var(--color-seafoam), transparent 80%)",
                        color: "var(--color-seafoam)",
                      }}
                    >
                      {part.text}
                    </span>
                  ) : (
                    <span key={i}>{part.text}</span>
                  ),
                )}
            </p>
          </div>
        </div>
      </div>

      {/* Footer buttons */}
      <div className="flex items-center gap-2 pt-2">
        <Button onClick={onApply} style={{ background: "var(--color-seafoam)", color: "white" }}>
          <Check className="mr-1.5 h-4 w-4" /> Apply best description
        </Button>
        <Button variant="outline" onClick={onDiscard}>
          Discard
        </Button>
        <Button variant="ghost" onClick={onRunAgain}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Run again
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
