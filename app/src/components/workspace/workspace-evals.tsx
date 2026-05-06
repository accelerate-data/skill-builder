import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SaveScenario, ScenarioDto } from "@/lib/eval-workbench";
import {
  buildRefineImprovementBrief,
  createDraftScenario,
  getErrorMessage,
  validateScenarioForEvaluation,
  runEvalWorkbench,
  normalizeScenario,
  scenarioToDraft,
  PERFORMANCE_CANDIDATE_IDS,
} from "@/lib/eval-workbench";
import { setEvalsRunning } from "@/lib/eval-running-state";
import type { ImportedSkill, SkillSummary } from "@/lib/types";
import { useRefineStore } from "@/stores/refine-store";
import { useSettingsStore } from "@/stores/settings-store";
import { formatModelName } from "@/stores/agent-store";
import { PromptSetEditor } from "./eval-workbench/prompt-set-editor";
import { ResultTable } from "./eval-workbench/result-table";
import { useRunHistory } from "./eval-workbench/use-run-history";
import { formatElapsed } from "@/lib/utils";

interface WorkspaceEvalsProps {
  skill: SkillSummary | ImportedSkill;
  workspacePath: string | null;
  scenario: ScenarioDto | null;
  hasScenarios?: boolean;
  scenarioLoading?: boolean;
  onStartNewScenario: () => void;
  onCreateScenario?: (mode: "performance") => Promise<ScenarioDto>;
  onSaveScenario: (
    scenario: ScenarioDto,
    options?: { previousScenarioName?: string | null },
  ) => Promise<ScenarioDto>;
  onSuggestScenario?: (scenarioName: string) => Promise<ScenarioDto>;
  onDeleteScenario?: (scenarioName: string) => Promise<void>;
  saveScenarioPending?: boolean;
  suggestScenarioPending?: boolean;
  deleteScenarioPending?: boolean;
  onNavigateToRefine?: () => void;
  onRunningChange?: (running: boolean) => void;
}

export function WorkspaceEvals({
  skill,
  workspacePath,
  scenario,
  hasScenarios = Boolean(scenario),
  scenarioLoading = false,
  onStartNewScenario,
  onCreateScenario,
  onSaveScenario,
  onSuggestScenario,
  onDeleteScenario,
  saveScenarioPending = false,
  suggestScenarioPending = false,
  deleteScenarioPending = false,
  onNavigateToRefine,
  onRunningChange,
}: WorkspaceEvalsProps) {
  const skillName = "name" in skill ? skill.name : skill.skill_name;
  const pluginSlug = skill.plugin_slug;
  const currentModel = useSettingsStore((state) => state.modelSettings.model);

  const [suggestingScenario, setSuggestingScenario] = useState(false);
  const [suggestScenarioStartedAt, setSuggestScenarioStartedAt] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [sendingToRefine, setSendingToRefine] = useState(false);
  const [draft, setDraft] = useState<SaveScenario>(() =>
    createDraftScenario("performance"),
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [suggestionStatusError, setSuggestionStatusError] = useState<string | null>(null);
  const lastPersistedSnapshotRef = useRef<string | null>(null);
  const [, setSuggestStatusTick] = useState(0);
  const {
    activeRunId,
    cancelActiveRun,
    clearActiveRun,
    error,
    loading,
    prependRun,
    progress,
    refresh,
    runs,
    selectRun,
    selectedRun,
    selectedRunId,
    startActiveRun,
  } = useRunHistory({
    pluginSlug,
    skillName,
    mode: "performance",
    workspacePath,
    scenarioName: hasScenarios ? "Package" : null,
  });

  useEffect(() => {
    setDraft(scenario ? scenarioToDraft(scenario) : createDraftScenario("performance"));
    lastPersistedSnapshotRef.current = scenario
      ? JSON.stringify(normalizeScenario(scenario))
      : null;
    setActionError(null);
    setSuggestionStatusError(null);
  }, [scenario]);

  useEffect(() => {
    onRunningChange?.(running);
    setEvalsRunning(running);
  }, [running, onRunningChange]);

  useEffect(() => {
    if (!(suggestingScenario || suggestScenarioPending) || !suggestScenarioStartedAt) {
      return;
    }
    const id = window.setInterval(
      () => setSuggestStatusTick((tick) => tick + 1),
      1000,
    );
    return () => window.clearInterval(id);
  }, [suggestScenarioPending, suggestScenarioStartedAt, suggestingScenario]);

  useEffect(
    () => () => {
      onRunningChange?.(false);
      setEvalsRunning(false);
    },
    [onRunningChange],
  );

  async function handleSelectRun(runId: string) {
    setActionError(null);
    try {
      await selectRun(runId);
    } catch (runError) {
      setActionError(getErrorMessage(runError));
    }
  }

  useEffect(() => {
    if (!scenario || scenarioLoading || saveScenarioPending || suggestingScenario || running) {
      return;
    }

    const normalizedDraft = normalizeScenario(draft);
    const nextSnapshot = JSON.stringify(normalizedDraft);
    if (nextSnapshot === lastPersistedSnapshotRef.current) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const saved = await onSaveScenario(normalizedDraft, {
            previousScenarioName: scenario.name,
          });
          lastPersistedSnapshotRef.current = JSON.stringify(normalizeScenario(saved));
          setDraft(scenarioToDraft(saved));
        } catch (saveError) {
          setActionError(getErrorMessage(saveError));
        }
      })();
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [
    draft,
    onSaveScenario,
    running,
    saveScenarioPending,
    scenario,
    scenarioLoading,
    suggestingScenario,
  ]);

  async function handleCreateScenario() {
    if (!onCreateScenario) {
      return;
    }

    onStartNewScenario();
    setActionError(null);
    setSuggestionStatusError(null);
    try {
      const created = await onCreateScenario("performance");
      lastPersistedSnapshotRef.current = JSON.stringify(normalizeScenario(created));
      setDraft(scenarioToDraft(created));
    } catch (createError) {
      setActionError(getErrorMessage(createError));
    }
  }

  async function handleSuggestScenario() {
    if (!scenario || !onSuggestScenario) {
      return;
    }
    setSuggestingScenario(true);
    setSuggestScenarioStartedAt(Date.now());
    setActionError(null);
    setSuggestionStatusError(null);
    try {
      const saved = await onSuggestScenario(scenario.name);
      lastPersistedSnapshotRef.current = JSON.stringify(normalizeScenario(saved));
      setDraft(scenarioToDraft(saved));
    } catch (suggestionError) {
      const message = getErrorMessage(suggestionError);
      if (/structured result was not valid json/i.test(message)) {
        setSuggestionStatusError(
          `Scenario suggestion failed: invalid JSON in structured result. ${message}`,
        );
      } else {
        setSuggestionStatusError(`Scenario suggestion failed: ${message}`);
      }
    } finally {
      setSuggestingScenario(false);
      setSuggestScenarioStartedAt(null);
    }
  }

  async function handleDeleteScenario() {
    if (!scenario || !onDeleteScenario) {
      return;
    }

    setActionError(null);
    setSuggestionStatusError(null);
    setSuggestScenarioStartedAt(null);
    try {
      await onDeleteScenario(scenario.name);
      setDraft(createDraftScenario("performance"));
    } catch (deleteError) {
      setActionError(getErrorMessage(deleteError));
    }
  }

  async function handleRunScenario() {
    if (!hasScenarios) {
      setActionError("Add at least one scenario before evaluating the package.");
      return;
    }

    if (scenario) {
      const validationError = validateScenarioForEvaluation(draft, "performance");
      if (validationError) {
        setActionError(validationError);
        return;
      }
    }

    const runId = crypto.randomUUID();
    setRunning(true);
    setActionError(null);
    startActiveRun(runId);
    try {
      const run = await runEvalWorkbench({
        runId,
        pluginSlug,
        skillName,
        mode: "performance",
        candidateIds: PERFORMANCE_CANDIDATE_IDS,
      });
      prependRun(run);
      await handleSelectRun(run.id);
    } catch (runError) {
      setActionError(getErrorMessage(runError));
    } finally {
      setRunning(false);
      clearActiveRun();
    }
  }

  async function handleCancelRun() {
    try {
      await cancelActiveRun();
    } catch (cancelError) {
      setActionError(getErrorMessage(cancelError));
    }
  }

  async function handleSendToRefine() {
    if (!selectedRunId) {
      return;
    }
    setSendingToRefine(true);
    setActionError(null);
    try {
      const brief = await buildRefineImprovementBrief(selectedRunId);
      useRefineStore.getState().setPendingInitialMessage(brief.brief);
      onNavigateToRefine?.();
    } catch (briefError) {
      setActionError(getErrorMessage(briefError));
    } finally {
      setSendingToRefine(false);
    }
  }

  if (!workspacePath) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Configure a workspace before using Eval Workbench.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading Eval Workbench…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          Retry
        </Button>
      </div>
    );
  }

  const suggestStatusTone =
    suggestingScenario || suggestScenarioPending
      ? "running"
      : suggestionStatusError
        ? "error"
        : "idle";
  const suggestStatusElapsed =
    suggestStatusTone === "running" && suggestScenarioStartedAt
      ? formatElapsed(Math.max(0, Date.now() - suggestScenarioStartedAt))
      : null;

  return (
    <div className="flex flex-col gap-6">
      {actionError ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      ) : null}

      {scenario ? (
        <PromptSetEditor
          draft={draft}
          onChange={setDraft}
          onNew={() => void handleCreateScenario()}
          onSuggest={() => void handleSuggestScenario()}
          onDelete={() => void handleDeleteScenario()}
          suggestDisabled={
            scenarioLoading || suggestingScenario || suggestScenarioPending || !scenario
          }
          suggestBusy={suggestingScenario || suggestScenarioPending}
          deleteDisabled={scenarioLoading || deleteScenarioPending || !scenario}
          showDelete={Boolean(scenario)}
          showNew={false}
          footerStatus={
            suggestingScenario || suggestScenarioPending
              ? {
                  tone: "running",
                  message: "Reading skill and drafting scenario…",
                }
              : suggestionStatusError
                ? {
                    tone: "error",
                    message: suggestionStatusError,
                  }
                : null
          }
        />
      ) : null}

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Results</h2>
            <p className="text-xs text-muted-foreground">
              Evaluate the package and inspect recent results.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => void handleRunScenario()}
              disabled={scenarioLoading || running || !hasScenarios || saveScenarioPending}
            >
              <Play className="mr-1 size-3.5" />
              Evaluate
            </Button>
            {running && activeRunId ? (
              <Button size="sm" variant="outline" onClick={() => void handleCancelRun()}>
                <Square className="mr-1 size-3.5" />
                Cancel
              </Button>
            ) : null}
          </div>
        </div>

        {running && progress ? (
          <p className="mb-4 text-xs text-muted-foreground">
            {progress.message} ({progress.completed}/{progress.total})
          </p>
        ) : null}

        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No evaluations yet. Run Evaluate to score this package.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(240px,320px)_1fr]">
            <div className="space-y-2">
              {runs.map((run) => {
                const summary = run.summary as { passed?: number; total?: number };
                return (
                  <Button
                    key={run.id}
                    type="button"
                    variant={selectedRunId === run.id ? "secondary" : "outline"}
                    className="flex h-auto w-full items-start justify-between gap-3 p-3 text-left"
                    onClick={() => void handleSelectRun(run.id)}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{run.id}</p>
                      <p className="text-xs text-muted-foreground">
                        {summary.passed ?? 0}/{summary.total ?? 0} passed
                      </p>
                    </div>
                  </Button>
                );
              })}
            </div>

            <div className="rounded-lg border bg-background/60 p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">
                    {selectedRun ? `Run ${selectedRun.id}` : "Run details"}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Review expectation-level results and send findings to Refine.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={scenarioLoading || !selectedRun || sendingToRefine}
                  onClick={() => void handleSendToRefine()}
                >
                  <ArrowRight className="mr-1 size-3.5" />
                  {sendingToRefine ? "Sending…" : "Send to Refine"}
                </Button>
              </div>

              {selectedRun ? (
                <ResultTable mode="performance" run={selectedRun} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Select a run to inspect its results.
                </p>
              )}
            </div>
          </div>
        )}
      </section>

      <div
        className="flex h-6 shrink-0 items-center gap-2.5 border-t border-border bg-background/80 px-4"
        data-testid="eval-suggest-status-bar"
      >
        <div className="flex items-center gap-1.5">
          <div
            className={
              suggestStatusTone === "running"
                ? "size-[5px] rounded-full animate-pulse"
                : suggestStatusTone === "error"
                  ? "size-[5px] rounded-full bg-destructive"
                  : "size-[5px] rounded-full bg-muted-foreground/40"
            }
            style={
              suggestStatusTone === "running"
                ? { background: "var(--color-pacific)" }
                : undefined
            }
          />
          <span className="text-xs text-muted-foreground/60">
            {suggestStatusTone === "running"
              ? "running…"
              : suggestStatusTone === "error"
                ? "error"
                : "ready"}
          </span>
        </div>

        {currentModel ? (
          <>
            <span className="text-muted-foreground/20">&middot;</span>
            <span className="text-xs text-muted-foreground/60">
              {formatModelName(currentModel)}
            </span>
          </>
        ) : null}

        {suggestStatusElapsed ? (
          <>
            <span className="text-muted-foreground/20">&middot;</span>
            <span className="text-xs font-mono tabular-nums text-muted-foreground/60">
              {suggestStatusElapsed}
            </span>
          </>
        ) : null}

        {suggestStatusTone === "error" && suggestionStatusError ? (
          <>
            <span className="text-muted-foreground/20">&middot;</span>
            <span className="truncate text-xs text-destructive/90">
              {suggestionStatusError}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
