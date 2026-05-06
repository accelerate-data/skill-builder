import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EvalRun,
  EvalWorkbenchMode,
  EvalWorkbenchProgressEvent,
} from "@/lib/eval-workbench";
import {
  cancelEvalWorkbenchRun,
  getErrorMessage,
  listEvalRuns,
  readEvalRun,
} from "@/lib/eval-workbench";
import { setEvalsCancelHandler } from "@/lib/eval-running-state";

type UseRunHistoryOptions = {
  pluginSlug: string;
  skillName: string;
  mode: EvalWorkbenchMode;
  workspacePath: string | null;
  scenarioName: string | null;
};

export function useRunHistory({
  pluginSlug,
  skillName,
  mode,
  workspacePath,
  scenarioName,
}: UseRunHistoryOptions) {
  const contextKey = [
    workspacePath ?? "",
    pluginSlug,
    skillName,
    mode,
    scenarioName ?? "",
  ].join("::");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<EvalRun | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<EvalWorkbenchProgressEvent | null>(null);
  const latestContextKeyRef = useRef(contextKey);
  const refreshRequestIdRef = useRef(0);
  const readRequestIdRef = useRef(0);

  useEffect(() => {
    latestContextKeyRef.current = contextKey;
    refreshRequestIdRef.current += 1;
    readRequestIdRef.current += 1;
    setRuns([]);
    setSelectedRunId(null);
    setSelectedRun(null);
    setActiveRunId(null);
    setProgress(null);
    setError(null);
  }, [contextKey]);

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
    const requestId = refreshRequestIdRef.current + 1;
    refreshRequestIdRef.current = requestId;
    const requestContextKey = latestContextKeyRef.current;
    setLoading(true);
    setError(null);
    try {
      const nextRuns = await listEvalRuns(
        pluginSlug,
        skillName,
        mode,
        20,
        scenarioName,
      );
      if (
        refreshRequestIdRef.current !== requestId ||
        latestContextKeyRef.current !== requestContextKey
      ) {
        return;
      }
      setRuns(nextRuns);
    } catch (loadError) {
      if (
        refreshRequestIdRef.current !== requestId ||
        latestContextKeyRef.current !== requestContextKey
      ) {
        return;
      }
      setError(getErrorMessage(loadError));
    } finally {
      if (
        refreshRequestIdRef.current === requestId &&
        latestContextKeyRef.current === requestContextKey
      ) {
        setLoading(false);
      }
    }
  }, [mode, pluginSlug, scenarioName, skillName]);

  useEffect(() => {
    if (!workspacePath) {
      setLoading(false);
      return;
    }
    void refresh();
  }, [refresh, workspacePath]);

  const selectRun = useCallback(async (runId: string) => {
    setSelectedRunId(runId);
    const requestId = readRequestIdRef.current + 1;
    readRequestIdRef.current = requestId;
    const requestContextKey = latestContextKeyRef.current;
    const run = await readEvalRun(runId);
    if (
      readRequestIdRef.current !== requestId ||
      latestContextKeyRef.current !== requestContextKey
    ) {
      return null;
    }
    setSelectedRun(run);
    return run;
  }, []);

  const prependRun = useCallback((run: EvalRun) => {
    setRuns((currentRuns) => [
      run,
      ...currentRuns.filter((currentRun) => currentRun.id !== run.id),
    ]);
  }, []);

  const startActiveRun = useCallback((runId: string) => {
    setActiveRunId(runId);
    setProgress(null);
  }, []);

  const clearActiveRun = useCallback(() => {
    setActiveRunId(null);
    setProgress(null);
  }, []);

  const cancelActiveRun = useCallback(async () => {
    if (!activeRunId) {
      return;
    }
    await cancelEvalWorkbenchRun(activeRunId);
  }, [activeRunId]);

  return {
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
  };
}
