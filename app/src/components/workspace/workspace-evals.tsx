import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ImportedSkill, SkillSummary } from "@/lib/types";
import {
  buildRefineImprovementBrief,
  cancelEvalWorkbenchRun,
  createDraftPromptSet,
  type EvalWorkbenchProgressEvent,
  getErrorMessage,
  listEvalPromptSets,
  listEvalRuns,
  normalizePromptSet,
  PERFORMANCE_CANDIDATE_IDS,
  promptSetToDraft,
  readEvalRun,
  runEvalWorkbench,
  saveEvalPromptSet,
  type EvalRun,
  type SaveEvalPromptSet,
  validatePromptSet,
} from "@/lib/eval-workbench";
import {
  setEvalsCancelHandler,
  setEvalsRunning,
} from "@/lib/eval-running-state";
import { useRefineStore } from "@/stores/refine-store";
import { PromptSetEditor } from "./eval-workbench/prompt-set-editor";
import { ResultTable } from "./eval-workbench/result-table";
import { RunHistory } from "./eval-workbench/run-history";

interface WorkspaceEvalsProps {
  skill: SkillSummary | ImportedSkill;
  workspacePath: string | null;
  onNavigateToRefine?: () => void;
  onRunningChange?: (running: boolean) => void;
}

export function WorkspaceEvals({
  skill,
  workspacePath,
  onNavigateToRefine,
  onRunningChange,
}: WorkspaceEvalsProps) {
  const skillName = "name" in skill ? skill.name : skill.skill_name;
  const pluginSlug = skill.plugin_slug;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [sendingToRefine, setSendingToRefine] = useState(false);
  const [promptSets, setPromptSets] = useState<Awaited<
    ReturnType<typeof listEvalPromptSets>
  >>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [selectedPromptSetId, setSelectedPromptSetId] = useState<string | null>(
    null,
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<EvalRun | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<EvalWorkbenchProgressEvent | null>(
    null,
  );
  const [draft, setDraft] = useState<SaveEvalPromptSet>(() =>
    createDraftPromptSet("performance", pluginSlug, skillName),
  );
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const isRunning = running;

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
      const [nextPromptSets, nextRuns] = await Promise.all([
        listEvalPromptSets(pluginSlug, skillName, "performance"),
        listEvalRuns(pluginSlug, skillName, "performance", 20),
      ]);
      setPromptSets(nextPromptSets);
      setRuns(nextRuns);

      const selectedPromptSet =
        nextPromptSets.find((promptSet) => promptSet.id === selectedPromptSetId) ??
        nextPromptSets[0] ??
        null;
      if (selectedPromptSet) {
        setSelectedPromptSetId(selectedPromptSet.id);
        setDraft(promptSetToDraft(selectedPromptSet));
      } else {
        setSelectedPromptSetId(null);
        setDraft(createDraftPromptSet("performance", pluginSlug, skillName));
      }
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [pluginSlug, selectedPromptSetId, skillName]);

  useEffect(() => {
    if (!workspacePath) {
      setLoading(false);
      return;
    }
    void refresh();
  }, [refresh, workspacePath]);

  async function handleSelectRun(runId: string) {
    setActionError(null);
    setSelectedRunId(runId);
    try {
      const run = await readEvalRun(runId);
      setSelectedRun(run);
    } catch (runError) {
      setActionError(getErrorMessage(runError));
    }
  }

  async function handleSavePromptSet() {
    const validationError = validatePromptSet(draft);
    if (validationError) {
      setActionError(validationError);
      return;
    }

    setSaving(true);
    setActionError(null);
    try {
      const saved = await saveEvalPromptSet(normalizePromptSet(draft));
      setSelectedPromptSetId(saved.id);
      setDraft(promptSetToDraft(saved));
      await refresh();
    } catch (saveError) {
      setActionError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function handleRunPromptSet() {
    if (!draft.id) {
      setActionError("Save the prompt set before running it.");
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
        promptSetId: draft.id,
        candidateIds: PERFORMANCE_CANDIDATE_IDS,
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
              App-owned prompt sets and run history for skill output quality.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => void handleRunPromptSet()}
              disabled={running}
            >
              <Play className="mr-1 size-3.5" />
              Run prompt set
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

        {promptSets.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {promptSets.map((promptSet) => (
              <Button
                key={promptSet.id}
                type="button"
                size="sm"
                variant={
                  selectedPromptSetId === promptSet.id ? "secondary" : "outline"
                }
                onClick={() => {
                  setSelectedPromptSetId(promptSet.id);
                  setDraft(promptSetToDraft(promptSet));
                  setActionError(null);
                }}
              >
                {promptSet.name}
              </Button>
            ))}
          </div>
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
        onChange={setDraft}
        onSave={() => void handleSavePromptSet()}
        onNew={() => {
          setSelectedPromptSetId(null);
          setDraft(createDraftPromptSet("performance", pluginSlug, skillName));
          setActionError(null);
        }}
        saveDisabled={saving}
      />

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
              Review the latest failures, then hand the brief to Refine.
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
        <ResultTable mode="performance" run={selectedRun} />
      </section>
    </div>
  );
}
