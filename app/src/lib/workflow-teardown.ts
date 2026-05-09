import { endWorkflowSession } from "@/lib/tauri";
import { useAgentStore } from "@/stores/agent-store";
import { useWorkflowStore } from "@/stores/workflow-store";

interface TeardownWorkflowSessionOptions {
  logPrefix: string;
  clearSessionId?: boolean;
}

export function teardownWorkflowSession({
  logPrefix,
  clearSessionId = false,
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
  useAgentStore.getState().clearRuns();

  if (!workflowSessionId) return;

  endWorkflowSession(workflowSessionId).catch((e) => {
    console.warn(`[${logPrefix}] non-fatal: op=endWorkflowSession err=%s`, e);
  });

  if (clearSessionId) {
    useWorkflowStore.setState({ workflowSessionId: null });
  }
}
