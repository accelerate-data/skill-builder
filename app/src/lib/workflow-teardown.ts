import { endWorkflowSession } from "@/lib/tauri";
import { useSessionRuntimeStore } from "@/stores/session-runtime-store";
import { useWorkflowStore } from "@/stores/workflow-store";

interface TeardownWorkflowSessionOptions {
  logPrefix: string;
  clearSessionId?: boolean;
  onEndSessionError?: (err: unknown) => void;
}

export function teardownWorkflowSession({
  logPrefix,
  clearSessionId = false,
  onEndSessionError,
}: TeardownWorkflowSessionOptions) {
  const store = useWorkflowStore.getState();
  const { currentStep, steps, workflowSessionId } = store;

  if (steps[currentStep]?.status === "in_progress") {
    store.updateStepStatus(currentStep, "pending");
  }

  store.setRunning(false);
  store.setStopping(false);
  store.setGateLoading(false);
  store.clearInitializing();
  store.clearRuntimeError();
  useSessionRuntimeStore.getState().clearSessionRuns();

  if (!workflowSessionId) return;

  endWorkflowSession(workflowSessionId).catch((e) => {
    console.warn(`[${logPrefix}] non-fatal: op=endWorkflowSession err=%s`, e);
    onEndSessionError?.(e);
  });

  if (clearSessionId) {
    useWorkflowStore.setState({ workflowSessionId: null });
  }
}
