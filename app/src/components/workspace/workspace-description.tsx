import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Sparkles, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  DescriptionCandidate,
  EvalRun,
  EvalWorkbenchProgressEvent,
  ScenarioDto,
} from "@/lib/eval-workbench";
import {
  applyDescriptionCandidate,
  areScenariosEqual,
  buildRefineImprovementBrief,
  buildTriggerCandidateIds,
  buildTriggerComparisonEntries,
  cancelEvalWorkbenchRun,
  createDraftScenario,
  DEFAULT_DESCRIPTION_CANDIDATE_COUNT,
  getErrorMessage,
  getRecommendedCandidate,
  getRunCandidateIds,
  listEvalRuns,
  normalizeScenario,
  readEvalRun,
  runEvalWorkbench,
  scenarioToDraft,
  suggestDescriptionCandidates,
  validateScenario,
} from "@/lib/eval-workbench";
import {
  setEvalsCancelHandler,
  setEvalsRunning,
} from "@/lib/eval-running-state";
import type { SkillSummary } from "@/lib/types";
import { useRefineStore } from "@/stores/refine-store";
import { CandidateCards } from "./eval-workbench/candidate-cards";
import { PromptSetEditor } from "./eval-workbench/prompt-set-editor";
import { ResultTable } from "./eval-workbench/result-table";
import { RunHistory } from "./eval-workbench/run-history";

interface WorkspaceDescriptionProps {
  skill: SkillSummary;
  workspacePath: string;
  scenario: ScenarioDto | null;
  onStartNewScenario: () => void;
  onSaveScenario: (scenario: ScenarioDto) => Promise<ScenarioDto>;
  saveScenarioPending?: boolean;
  onRunningChange?: (running: boolean) => void;
  onApply?: (newDescription: string, newVersion: string) => void;
  onNavigateToRefine?: () => void;
}

export function WorkspaceDescription({
  skill,
  workspacePath,
  scenario,
  onStartNewScenario,
  onSaveScenario,
  saveScenarioPending = false,
  onRunningChange,
  onApply,
  onNavigateToRefine,
}: WorkspaceDescriptionProps) {
  const [loading, setLoading] = useState(true);
  const [generatingCandidates, setGeneratingCandidates] = useState(false);
  const [running, setRunning] = useState(false);
  const [sendingToRefine, setSendingToRefine] = useState(false);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<EvalRun | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<EvalWorkbenchProgressEvent | null>(
    null,
  );
  const [draft, setDraft] = useState<ScenarioDto>(() =>
    createDraftScenario("trigger"),
  );
  const [candidates, setCandidates] = useState<DescriptionCandidate[]>([]);
  const [appliedDescription, setAppliedDescription] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const isRunning = generatingCandidates || running;

  useEffect(() => {
    setDraft(scenario ? scenarioToDraft(scenario) : createDraftScenario("trigger"));
    setCandidates([]);
    setActionError(null);
  }, [scenario]);

  const baselineDescription = skill.description ?? "";
  const activeScenarioCases = scenario?.cases ?? [];
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

  useEffect(() => {
    if (!activeRunId) {
      setEvalsCancelHandler(null);
      return;
    }

    setEvalsCancelHandler(async () => {
      await cancelEvalWorkbenchRun(activeRunId);
    });
    return () => {
      setEvalsCancelHandler(null);
    };
  }, [activeRunId]);

  useEffect(
    () => () => {
      onRunningChange?.(false);
      setEvalsRunning(false);
      setEvalsCancelHandler(null);
    },
    [onRunningChange],
  );

  useEffect(() => {
    const unlisten = listen<EvalWorkbenchProgressEvent>(
      "eval-workbench-progress",
      (event) => {
        const payload = event.payload;
        if (!activeRunId || payload.runId !== activeRunId) {
          return;
        }
        setProgress(payload);
      },
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [activeRunId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextRuns = await listEvalRuns(skill.plugin_slug, skill.name, "trigger", 20);
      setRuns(nextRuns);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [skill.name, skill.plugin_slug]);

  useEffect(() => {
    if (!workspacePath) {
      setLoading(false);
      return;
    }
    void refresh();
  }, [refresh, workspacePath]);

  async function handleSelectRun(runId: string) {
    setSelectedRunId(runId);
    setActionError(null);
    try {
      const run = await readEvalRun(runId);
      setSelectedRun(run);
      setCandidates(run?.descriptionCandidates ?? []);
    } catch (runError) {
      setActionError(getErrorMessage(runError));
    }
  }

  async function handleSaveScenario() {
    const validationError = validateScenario(draft);
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
    setActiveRunId(runId);
    setProgress(null);
    try {
      const run = await runEvalWorkbench({
        runId,
        pluginSlug: skill.plugin_slug,
        skillName: skill.name,
        scenarioName: scenario.name,
        mode: "trigger",
        candidateIds,
      });
      setRuns((currentRuns) => [
        run,
        ...currentRuns.filter((currentRun) => currentRun.id !== run.id),
      ]);
      await handleSelectRun(run.id);
    } catch (runError) {
      setActionError(getErrorMessage(runError));
    } finally {
      setRunning(false);
      setActiveRunId(null);
      setProgress(null);
    }
  }

  async function handleCancelRun() {
    if (!activeRunId) {
      return;
    }

    try {
      await cancelEvalWorkbenchRun(activeRunId);
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
      <section className="rounded-lg border bg-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold">Eval Workbench</h1>
              <Badge variant="outline">Trigger</Badge>
            </div>
            {scenario ? (
              <p className="mt-1 text-sm font-medium">{scenario.name}</p>
            ) : null}
            <p className="mt-1 text-sm text-muted-foreground">
              Generate description candidates, compare them, then push the best
              findings into Refine.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleGenerateCandidates()}
              disabled={generatingCandidates}
            >
              <Sparkles className="mr-1 size-3.5" />
              Generate candidates
            </Button>
            <Button
              size="sm"
              onClick={() => void handleRunComparison()}
              disabled={running}
            >
              Run comparison
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

      <PromptSetEditor
        draft={draft}
        mode="trigger"
        onChange={setDraft}
        onSave={() => void handleSaveScenario()}
        onNew={() => {
          onStartNewScenario();
          setDraft(createDraftScenario("trigger"));
          setCandidates([]);
          setActionError(null);
        }}
        saveDisabled={saveScenarioPending}
      />

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

      <RunHistory
        runs={runs}
        selectedRunId={selectedRunId}
        onSelectRun={(runId) => void handleSelectRun(runId)}
      />

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Run details</h2>
            <p className="text-xs text-muted-foreground">
              Inspect candidate outcomes, then hand the brief to Refine.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleSendToRefine()}
            disabled={!selectedRunId || sendingToRefine}
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
      </section>
    </div>
  );
}
