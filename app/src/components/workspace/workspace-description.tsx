import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DescriptionCandidate, ScenarioDto } from "@/lib/eval-workbench";
import {
  applyDescriptionCandidate,
  areScenariosEqual,
  buildRefineImprovementBrief,
  buildTriggerCandidateIds,
  buildTriggerComparisonEntries,
  createDraftScenario,
  DEFAULT_DESCRIPTION_CANDIDATE_COUNT,
  getErrorMessage,
  getRecommendedCandidate,
  getRunCandidateIds,
  normalizeScenario,
  runEvalWorkbench,
  scenarioToDraft,
  suggestDescriptionCandidates,
  validateScenario,
} from "@/lib/eval-workbench";
import { setEvalsRunning } from "@/lib/eval-running-state";
import type { SkillSummary } from "@/lib/types";
import { useRefineStore } from "@/stores/refine-store";
import { CandidateCards } from "./eval-workbench/candidate-cards";
import { PromptSetEditor } from "./eval-workbench/prompt-set-editor";
import { ResultTable } from "./eval-workbench/result-table";
import { useRunHistory } from "./eval-workbench/use-run-history";

interface WorkspaceDescriptionProps {
  skill: SkillSummary;
  workspacePath: string;
  scenario: ScenarioDto | null;
  scenarioLoading?: boolean;
  onStartNewScenario: () => void;
  onCreateScenario?: (mode: "trigger") => Promise<ScenarioDto>;
  onSaveScenario: (
    scenario: ScenarioDto,
    options?: { previousScenarioName?: string | null },
  ) => Promise<ScenarioDto>;
  onDeleteScenario?: (scenarioName: string) => Promise<void>;
  saveScenarioPending?: boolean;
  onRunningChange?: (running: boolean) => void;
  onApply?: (newDescription: string, newVersion: string) => void;
  onNavigateToRefine?: () => void;
}

export function WorkspaceDescription({
  skill,
  workspacePath,
  scenario,
  scenarioLoading = false,
  onStartNewScenario,
  onCreateScenario,
  onSaveScenario,
  onDeleteScenario,
  saveScenarioPending = false,
  onRunningChange,
  onApply,
  onNavigateToRefine,
}: WorkspaceDescriptionProps) {
  const [generatingCandidates, setGeneratingCandidates] = useState(false);
  const [running, setRunning] = useState(false);
  const [sendingToRefine, setSendingToRefine] = useState(false);
  const [draft, setDraft] = useState<ScenarioDto>(() =>
    createDraftScenario("trigger"),
  );
  const [candidates, setCandidates] = useState<DescriptionCandidate[]>([]);
  const [appliedDescription, setAppliedDescription] = useState<string | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const lastPersistedSnapshotRef = useRef<string | null>(null);
  const isRunning = generatingCandidates || running;
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
    pluginSlug: skill.plugin_slug,
    skillName: skill.name,
    mode: "trigger",
    workspacePath,
    scenarioName: scenario?.name ?? null,
  });

  useEffect(() => {
    setDraft(scenario ? scenarioToDraft(scenario) : createDraftScenario("trigger"));
    lastPersistedSnapshotRef.current = scenario
      ? JSON.stringify(normalizeScenario(scenario))
      : null;
    setCandidates([]);
    setActionError(null);
  }, [scenario]);

  const baselineDescription = skill.description ?? "";
  const activeScenarioCases = scenario ? [scenario] : [];
  const recommendedCandidate = useMemo(
    () =>
      getRecommendedCandidate(
        baselineDescription,
        candidates.length > 0 ? candidates : selectedRun?.descriptionCandidates ?? [],
        selectedRun,
        activeScenarioCases,
      ),
    [activeScenarioCases, baselineDescription, candidates, selectedRun],
  );
  const comparisonEntries = useMemo(
    () =>
      buildTriggerComparisonEntries(
        baselineDescription,
        candidates.length > 0 ? candidates : selectedRun?.descriptionCandidates ?? [],
        selectedRun,
        activeScenarioCases,
      ),
    [activeScenarioCases, baselineDescription, candidates, selectedRun],
  );

  useEffect(() => {
    onRunningChange?.(isRunning);
    setEvalsRunning(isRunning);
  }, [isRunning, onRunningChange]);

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
      const run = await selectRun(runId);
      setCandidates(run?.descriptionCandidates ?? []);
    } catch (runError) {
      setActionError(getErrorMessage(runError));
    }
  }

  useEffect(() => {
    if (!scenario || scenarioLoading || saveScenarioPending || generatingCandidates || running) {
      return;
    }

    const validationError = validateScenario(draft);
    if (validationError) {
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
    generatingCandidates,
    onSaveScenario,
    running,
    saveScenarioPending,
    scenario,
    scenarioLoading,
  ]);

  async function handleCreateScenario() {
    if (!onCreateScenario) {
      return;
    }

    onStartNewScenario();
    setActionError(null);
    try {
      const created = await onCreateScenario("trigger");
      lastPersistedSnapshotRef.current = JSON.stringify(normalizeScenario(created));
      setDraft(scenarioToDraft(created));
      setCandidates([]);
    } catch (createError) {
      setActionError(getErrorMessage(createError));
    }
  }

  async function handleDeleteScenario() {
    if (!scenario || !onDeleteScenario) {
      return;
    }

    setActionError(null);
    try {
      await onDeleteScenario(scenario.name);
      setDraft(createDraftScenario("trigger"));
      setCandidates([]);
    } catch (deleteError) {
      setActionError(getErrorMessage(deleteError));
    }
  }

  async function handleGenerateCandidates() {
    if (!scenario || !areScenariosEqual(scenario, draft)) {
      setActionError("Save the scenario before generating candidates.");
      return;
    }
    if (!baselineDescription.trim()) {
      setActionError("Add a skill description before generating candidates.");
      return;
    }

    setGeneratingCandidates(true);
    setActionError(null);
    try {
      const nextCandidates = await suggestDescriptionCandidates({
        pluginSlug: skill.plugin_slug,
        skillName: skill.name,
        scenarioName: scenario.name,
        baselineDescription,
        candidateCount: DEFAULT_DESCRIPTION_CANDIDATE_COUNT,
      });
      setCandidates(nextCandidates);
    } catch (candidateError) {
      setActionError(getErrorMessage(candidateError));
    } finally {
      setGeneratingCandidates(false);
    }
  }

  async function handleRunComparison() {
    if (!scenario || !areScenariosEqual(scenario, draft)) {
      setActionError("Save the scenario before running a comparison.");
      return;
    }

    const candidateIds = candidates.length
      ? buildTriggerCandidateIds(candidates)
      : getRunCandidateIds(selectedRun);
    if (candidateIds.length === 0) {
      setActionError("Generate candidates before running a comparison.");
      return;
    }

    const runId = crypto.randomUUID();
    setRunning(true);
    setActionError(null);
    startActiveRun(runId);
    try {
      const run = await runEvalWorkbench({
        runId,
        pluginSlug: skill.plugin_slug,
        skillName: skill.name,
        scenarioName: scenario.name,
        mode: "trigger",
        candidateIds,
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

  async function handleApplyCandidate(candidate: DescriptionCandidate) {
    setActionError(null);
    try {
      const applied = await applyDescriptionCandidate(
        skill.plugin_slug,
        skill.name,
        candidate.id,
      );
      setAppliedDescription(applied.description);
      onApply?.(applied.description, skill.version ?? "");
    } catch (applyError) {
      setActionError(getErrorMessage(applyError));
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
        Loading description workbench…
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
      {actionError ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      ) : null}

      {appliedDescription ? (
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm font-medium">Applied description</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {appliedDescription}
          </p>
        </div>
      ) : null}

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold">Current description</h2>
          <p className="text-xs text-muted-foreground">
            Baseline used for candidate generation and trigger comparison.
          </p>
        </div>
        <p className="text-sm">
          {baselineDescription || "No current description is set yet."}
        </p>
      </section>

      {scenario ? (
        <PromptSetEditor
          draft={draft}
          mode="trigger"
          onChange={setDraft}
          onNew={() => void handleCreateScenario()}
          onDelete={() => void handleDeleteScenario()}
          deleteDisabled={scenarioLoading || saveScenarioPending || !scenario}
          showDelete={Boolean(scenario)}
          showSuggest={false}
          showNew={false}
        />
      ) : null}

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold">Candidates</h2>
          <p className="text-xs text-muted-foreground">
            Review the generated descriptions before running or applying them.
          </p>
        </div>
        <CandidateCards
          entries={comparisonEntries}
          recommendedCandidateId={recommendedCandidate?.id ?? null}
          onApply={(candidate) => void handleApplyCandidate(candidate)}
        />
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Results</h2>
            <p className="text-xs text-muted-foreground">
              Evaluate the package, inspect candidate outcomes, then hand the brief to Refine.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleGenerateCandidates()}
              disabled={scenarioLoading || generatingCandidates}
            >
              <Sparkles className="mr-1 size-3.5" />
              Generate candidates
            </Button>
            <Button
              size="sm"
              onClick={() => void handleRunComparison()}
              disabled={scenarioLoading || running}
            >
              Evaluate
            </Button>
            {running && activeRunId ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleCancelRun()}
              >
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
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">
                    {selectedRun ? `Run ${selectedRun.id}` : "Run details"}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Inspect candidate outcomes, then hand the brief to Refine.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleSendToRefine()}
                  disabled={scenarioLoading || !selectedRunId || sendingToRefine}
                >
                  Send to Refine
                  <ArrowRight className="ml-1 size-3.5" />
                </Button>
              </div>
              <ResultTable
                mode="trigger"
                run={selectedRun}
                candidateLabelById={Object.fromEntries(
                  comparisonEntries.map((entry) => [
                    entry.candidate.id,
                    entry.candidate.label,
                  ]),
                )}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
