import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Play, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { PromptSetEditor } from "./eval-workbench/prompt-set-editor";
import { ResultTable } from "./eval-workbench/result-table";
import { RunHistory } from "./eval-workbench/run-history";
import { useRunHistory } from "./eval-workbench/use-run-history";

interface WorkspaceEvalsProps {
  skill: SkillSummary | ImportedSkill;
  workspacePath: string | null;
  scenario: ScenarioDto | null;
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

  const [suggestingScenario, setSuggestingScenario] = useState(false);
  const [running, setRunning] = useState(false);
  const [sendingToRefine, setSendingToRefine] = useState(false);
  const [draft, setDraft] = useState<SaveScenario>(() =>
    createDraftScenario("performance"),
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const lastPersistedSnapshotRef = useRef<string | null>(null);
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
    scenarioName: scenario ? "Package" : null,
  });

  useEffect(() => {
    setDraft(scenario ? scenarioToDraft(scenario) : createDraftScenario("performance"));
    lastPersistedSnapshotRef.current = scenario
      ? JSON.stringify(normalizeScenario(scenario))
      : null;
    setActionError(null);
  }, [scenario]);

  useEffect(() => {
    onRunningChange?.(running);
    setEvalsRunning(running);
  }, [running, onRunningChange]);

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
    setActionError(null);
    try {
      const saved = await onSuggestScenario(scenario.name);
      lastPersistedSnapshotRef.current = JSON.stringify(normalizeScenario(saved));
      setDraft(scenarioToDraft(saved));
    } catch (suggestionError) {
      const message = getErrorMessage(suggestionError);
      if (/structured result was not valid json/i.test(message)) {
        setActionError(`Scenario suggestion failed: invalid JSON in structured result. ${message}`);
      } else {
        setActionError(`Scenario suggestion failed: ${message}`);
      }
    } finally {
      setSuggestingScenario(false);
    }
  }

  async function handleDeleteScenario() {
    if (!scenario || !onDeleteScenario) {
      return;
    }

    setActionError(null);
    try {
      await onDeleteScenario(scenario.name);
      setDraft(createDraftScenario("performance"));
    } catch (deleteError) {
      setActionError(getErrorMessage(deleteError));
    }
  }

  async function handleRunScenario() {
    if (!scenario) {
      setActionError("Add at least one scenario before evaluating the package.");
      return;
    }

    const validationError = validateScenarioForEvaluation(draft, "performance");
    if (validationError) {
      setActionError(validationError);
      return;
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

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border bg-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold">Eval Workbench</h1>
              <Badge variant="outline">Performance</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Git-backed scenarios and run history for skill output quality.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => void handleRunScenario()}
              disabled={scenarioLoading || running || !scenario || saveScenarioPending}
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
          <p className="mt-3 text-xs text-muted-foreground">
            {progress.message} ({progress.completed}/{progress.total})
          </p>
        ) : null}
      </section>

      {actionError ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      ) : null}

      <PromptSetEditor
        draft={draft}
        mode="performance"
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
      />

      <RunHistory
        runs={runs}
        selectedRunId={selectedRunId}
        onSelectRun={(runId) => void handleSelectRun(runId)}
      />

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Latest run</h2>
            <p className="text-xs text-muted-foreground">
              Review the latest scenario output and send findings to Refine.
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
      </section>
    </div>
  );
}
