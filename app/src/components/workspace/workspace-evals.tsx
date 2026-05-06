import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Play, Sparkles, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SaveScenario, ScenarioDto } from "@/lib/eval-workbench";
import {
  areScenariosEqual,
  buildRefineImprovementBrief,
  createDraftScenario,
  generateScenarios,
  getErrorMessage,
  runEvalWorkbench,
  normalizeScenario,
  scenarioToDraft,
  validateScenario,
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
  onSaveScenario: (
    scenario: ScenarioDto,
    options?: { previousScenarioName?: string | null },
  ) => Promise<ScenarioDto>;
  saveScenarioPending?: boolean;
  onNavigateToRefine?: () => void;
  onRunningChange?: (running: boolean) => void;
}

export function WorkspaceEvals({
  skill,
  workspacePath,
  scenario,
  scenarioLoading = false,
  onStartNewScenario,
  onSaveScenario,
  saveScenarioPending = false,
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
    scenarioName: scenario?.name ?? null,
  });

  useEffect(() => {
    setDraft(scenario ? scenarioToDraft(scenario) : createDraftScenario("performance"));
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

  async function handleSaveScenario() {
    const validationError = validateScenario(draft, "performance");
    if (validationError) {
      setActionError(validationError);
      return;
    }

    setActionError(null);
    try {
      const saved = await onSaveScenario(normalizeScenario(draft));
      setDraft(scenarioToDraft(saved));
    } catch (saveError) {
      setActionError(getErrorMessage(saveError));
    }
  }

  async function handleSuggestScenario() {
    setSuggestingScenario(true);
    setActionError(null);
    try {
      const generated = await generateScenarios(pluginSlug, skillName);
      const suggested = generated[0];

      if (!suggested) {
        throw new Error("Suggestion did not return a scenario.");
      }

      setDraft((current) => ({
        ...current,
        name: current.name.trim() || suggested.name,
        tags: current.tags.includes("trigger") ? ["both"] : ["performance"],
        prompt: suggested.prompt,
        shouldTrigger: current.tags.includes("trigger")
          ? (suggested.shouldTrigger ?? true)
          : null,
        assertions: suggested.assertions,
      }));
    } catch (suggestionError) {
      setActionError(getErrorMessage(suggestionError));
    } finally {
      setSuggestingScenario(false);
    }
  }

  async function handleRunScenario() {
    if (!scenario || !areScenariosEqual(scenario, draft)) {
      setActionError("Save the scenario before running it.");
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
        scenarioName: scenario.name,
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
              variant="outline"
              onClick={() => void handleSuggestScenario()}
              disabled={scenarioLoading || suggestingScenario}
            >
              <Sparkles className="mr-1 size-3.5" />
              {suggestingScenario ? "Suggesting…" : "Suggest"}
            </Button>
            <Button
              size="sm"
              onClick={() => void handleRunScenario()}
              disabled={scenarioLoading || running || !scenario}
            >
              <Play className="mr-1 size-3.5" />
              Run scenario
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
        onSave={() => void handleSaveScenario()}
        onNew={() => {
          onStartNewScenario();
          setDraft(createDraftScenario("performance"));
          setActionError(null);
        }}
        saveDisabled={scenarioLoading || saveScenarioPending}
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
